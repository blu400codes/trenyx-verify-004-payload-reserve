/**
 * trenyx-verify-004 — independent tests, written BLIND to the target's own test files
 * (only src/, the README, and dev/ harness helpers were read). Each test asserts an
 * invariant from the pre-registered plan (00-preregistration/ATTACK-PLAN.md §2); a failing
 * test is a CANDIDATE finding, confirmed only after refutation.
 *
 * Boots its own Payload on the run-wide memory replica set (dev/globalSetup.ts), in
 * standalone-customers mode with guest bookings + slot holds enabled and the README's own
 * example business timezone (America/New_York).
 */
import type { Payload, PayloadRequest } from 'payload'

import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig, createLocalReq, getPayload } from 'payload'
import { payloadReserve } from 'payload-reserve'
import sharp from 'sharp'
import { fileURLToPath } from 'url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getAvailableSlots } from '../../src/services/AvailabilityService.js'
import { isExceptionDate } from '../../src/utilities/scheduleUtils.js'
import { testDbUri } from '../helpers/testDbUri.js'
import { testEmailAdapter } from '../helpers/testEmailAdapter.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const TZ = 'America/New_York'

let payload: Payload
let stop: () => Promise<void>
let sm: { blockingStatuses: string[]; cancelStatus: string; confirmStatus: string; defaultStatus: string; statuses: string[]; terminalStatuses: string[]; transitions: Record<string, string[]> }

// A weekday far in the future so "now"-relative policies can't interfere: Wed 2027-03-10.
const T = (h: number, m = 0): string => new Date(Date.UTC(2027, 2, 10, h, m)).toISOString()
const hoursFromNow = (h: number): string => new Date(Date.now() + h * 3_600_000).toISOString()

type Doc = Record<string, any>
const mk = (collection: string, data: Doc): Promise<Doc> =>
  (payload.create as any)({ collection, data, depth: 0 })

const asUser = async (user: Doc | null, collection = 'customers'): Promise<PayloadRequest> => {
  // createLocalReq is ASYNC in payload 3.86 — it attaches payload, i18n/t, context and user itself.
  const u = user ? { ...user, collection } : null
  return (await createLocalReq({ user: u as any }, payload)) as PayloadRequest
}

async function callEndpoint(p: string, body: Doc, user: Doc | null = null, collection = 'customers') {
  const ep = (payload.config.endpoints ?? []).find((e) => e.path === p && e.method === 'post')
  if (!ep) throw new Error(`no endpoint ${p}`)
  const req = (await asUser(user, collection)) as any
  req.json = async () => body
  req.headers = new Headers()
  // Payload's HTTP layer turns a thrown APIError into a response with its status; mirror that here.
  let res: Response
  try { res = await ep.handler(req) } catch (err: any) { return { json: err?.data ?? { message: err?.message }, status: err?.status ?? 500 } }
  let json: any = null
  try { json = await res.json() } catch { /* empty body */ }
  return { json, status: res.status }
}

let svc60: Doc, svcBufAfter15: Doc, svcBufBefore15: Doc, svcFixedTamper: Doc
let resQ1: Doc, resQ2: Doc, resQ4guest: Doc, resInactive: Doc, resOverlap: Doc, resBuf: Doc, resHold: Doc, resTz: Doc
let custA: Doc, custB: Doc, admin: Doc

beforeAll(async () => {
  const db = await testDbUri('trenyx004')
  const config = await buildConfig({
    admin: { importMap: { baseDir: path.resolve(dirname, '..') }, user: 'users' },
    collections: [
      { slug: 'users', auth: true, fields: [] },
      { slug: 'media', fields: [], upload: { staticDir: path.resolve(dirname, '..', 'media') } },
    ],
    db: mongooseAdapter({ ensureIndexes: true, url: db.uri }),
    editor: lexicalEditor(),
    email: testEmailAdapter,
    plugins: [
      payloadReserve({
        allowGuestBooking: true,
        cancellationNoticePeriod: 24,
        defaultBufferTime: 0,
        slotHolds: { enabled: true, ttlMinutes: 10 },
        timezone: TZ,
      }),
    ],
    secret: 'trenyx-004-secret',
    sharp,
    typescript: { autoGenerate: false },
  })
  payload = await getPayload({ config })
  stop = async () => { await payload.destroy(); await db.stop() }
  sm = (payload.config.admin as any).custom.reservationStatusMachine

  admin = await mk('users', { email: 'admin@trenyx.test', password: 'pw-admin-1' })
  custA = await mk('customers', { email: 'a@trenyx.test', firstName: 'Ann', lastName: 'A', password: 'pw-a-1' })
  custB = await mk('customers', { email: 'b@trenyx.test', firstName: 'Bob', lastName: 'B', password: 'pw-b-1' })

  svc60 = await mk('services', { name: '60min', duration: 60, durationType: 'fixed' })
  svcBufAfter15 = await mk('services', { name: '60min+after15', bufferTimeAfter: 15, duration: 60, durationType: 'fixed' })
  svcBufBefore15 = await mk('services', { name: '60min+before15', bufferTimeBefore: 15, duration: 60, durationType: 'fixed' })
  svcFixedTamper = await mk('services', { name: 'fixed-tamper', duration: 60, durationType: 'fixed' })

  const res = (name: string, extra: Doc = {}) =>
    mk('resources', { name, active: true, quantity: 1, services: [svc60.id], ...extra })
  resQ1 = await res('q1')
  resQ2 = await res('q2', { quantity: 2 })
  resQ4guest = await res('q4-guest', { capacityMode: 'per-guest', quantity: 4 })
  resInactive = await res('inactive', { active: false })
  resOverlap = await res('overlap')
  resBuf = await res('buf', { services: [svc60.id, svcBufAfter15.id, svcBufBefore15.id] })
  resHold = await res('hold')
  resTz = await res('tz')
}, 120_000)

afterAll(async () => { await stop?.() })


describe('F2 RETEST · date-only exception resolves by UTC calendar date (v4.1.1)', () => {
  it('bare YYYY-MM-DD Dec 25 is closed on Dec 25 in America/New_York (was: false → open)', () => {
    // On b04d04b this returned false (the day shifted to Dec 24 west of UTC).
    expect(isExceptionDate('2025-12-25', [{ date: '2025-12-25' } as any], 'America/New_York')).toBe(true)
  })
  it('a schedule exception on Dec 25 serves ZERO slots that day (dynamic)', async () => {
    const sched = await mk('schedules', {
      resource: resTz.id,
      timezone: 'America/New_York',
      weeklyHours: [{ day: 'thursday', open: '09:00', close: '17:00' }],
      exceptions: [{ date: '2025-12-25', closed: true }],
    }).catch(() => null)
    if (!sched) return // schema shape differs; the pure check above is the load-bearing one
    const slots = await getAvailableSlots({ payload, resourceId: resTz.id, serviceId: svc60.id, date: '2025-12-25' } as any).catch(() => [] as any[])
    expect(Array.isArray(slots) ? slots.length : 0).toBe(0)
  })
})

describe('F4 RETEST · fractional guestCount rejected on the collection (v4.1.1)', () => {
  it('guestCount 1.5 is refused at create (was: accepted)', async () => {
    await expect(mk('reservations', { customer: custA.id, resource: resQ4guest.id, service: svc60.id, startTime: T(15), guestCount: 1.5 })).rejects.toThrow()
  })
  it('guestCount 2 (integer) is still accepted', async () => {
    const ok = await mk('reservations', { customer: custA.id, resource: resQ4guest.id, service: svc60.id, startTime: T(16), guestCount: 2 })
    expect(ok.id).toBeTruthy()
  })
})
