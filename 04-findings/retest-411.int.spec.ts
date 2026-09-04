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


// ─────────────────────────────────────────────────────────────────────────────
// trenyx-verify-004 RETEST against payload-reserve v4.1.1 (162e6ae).
// Reconstructs the four WITHHELD I-AUTHZ takeover scenarios + the password-takeover
// probe from 04-findings F1, verbatim in intent, and asserts each is now DENIED.
// On b04d04b every assertion below was the OPPOSITE (takeover succeeded).
// ─────────────────────────────────────────────────────────────────────────────
describe('F1 RETEST · standalone customer cannot reach another customer (v4.1.1)', () => {
  const OA = { overrideAccess: false as const }
  const B = () => ({ ...custB, collection: 'customers' } as any)

  it('S1 — customer B cannot LIST customer A in /customers (was: totalDocs≥1)', async () => {
    const list = await (payload.find as any)({ collection: 'customers', ...OA, user: B(), depth: 0 })
    const ids = list.docs.map((d: any) => String(d.id))
    expect(ids).not.toContain(String(custA.id))              // A is not visible to B
    expect(ids.every((id: string) => id === String(custB.id))).toBe(true) // B sees only self
  })

  it('S2 — customer B cannot READ A\'s reservation by id (was: returned the doc)', async () => {
    const rA = await mk('reservations', { customer: custA.id, resource: resQ2.id, service: svc60.id, startTime: T(9) })
    const got = await (payload.findByID as any)({ id: rA.id, collection: 'reservations', depth: 0, disableErrors: true, ...OA, user: B() })
    expect(got).toBeFalsy()                                   // filtered out / not found
    const listed = await (payload.find as any)({ collection: 'reservations', ...OA, user: B(), depth: 0 })
    expect(listed.docs.map((d: any) => String(d.id))).not.toContain(String(rA.id))
  })

  it('S3 — customer B cannot UPDATE A\'s reservation (was: notes rewritten)', async () => {
    const rA = await mk('reservations', { customer: custA.id, resource: resQ2.id, service: svc60.id, startTime: T(11) })
    await expect((payload.update as any)({ id: rA.id, collection: 'reservations', data: { notes: 'hacked-by-B' }, ...OA, user: B() })).rejects.toThrow()
    const fresh = await (payload.findByID as any)({ id: rA.id, collection: 'reservations', depth: 0 })
    expect(fresh.notes).not.toBe('hacked-by-B')
  })

  it('S4 — customer B cannot DELETE A\'s reservation (delete is staff-only now)', async () => {
    const rA = await mk('reservations', { customer: custA.id, resource: resQ2.id, service: svc60.id, startTime: T(13) })
    await expect((payload.delete as any)({ id: rA.id, collection: 'reservations', ...OA, user: B() })).rejects.toThrow()
    const still = await (payload.findByID as any)({ id: rA.id, collection: 'reservations', depth: 0 })
    expect(still).toBeTruthy()
  })

  it('S5 — ACCOUNT TAKEOVER blocked: B cannot set A\'s password, and cannot log in as A (was: login token returned)', async () => {
    await expect((payload.update as any)({ id: custA.id, collection: 'customers', data: { password: 'pwned-by-B-9' }, ...OA, user: B() })).rejects.toThrow()
    // the original password must still be the only one that works
    await expect((payload.login as any)({ collection: 'customers', data: { email: 'a@trenyx.test', password: 'pwned-by-B-9' } })).rejects.toThrow()
    const asA = await (payload.login as any)({ collection: 'customers', data: { email: 'a@trenyx.test', password: 'pw-a-1' } })
    expect(asA?.token).toBeTruthy()                          // A's real password still works; account intact
  })
})
