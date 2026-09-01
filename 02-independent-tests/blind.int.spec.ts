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

// ───────────────────────────── I-AUTHZ (plan §4 G) ─────────────────────────────
describe('I-AUTHZ · default (plain-install) collection access between customers', () => {
  let aRes: Doc
  beforeAll(async () => {
    aRes = await mk('reservations', { customer: custA.id, resource: resQ1.id, service: svc60.id, startTime: T(15) })
  })
  it('customer B cannot READ customer A\'s reservation through the collection API', async () => {
    const r = await (payload.find as any)({ collection: 'reservations', depth: 0, overrideAccess: false, user: { ...custB, collection: 'customers' }, where: { id: { equals: aRes.id } } })
    expect(r.totalDocs).toBe(0)
  })
  it('customer B cannot UPDATE (reschedule/cancel) customer A\'s reservation', async () => {
    await expect((payload.update as any)({ id: aRes.id, collection: 'reservations', data: { notes: 'hijacked' }, overrideAccess: false, user: { ...custB, collection: 'customers' } })).rejects.toThrow()
    const after = await (payload.findByID as any)({ id: aRes.id, collection: 'reservations', depth: 0 })
    expect(after.notes).not.toBe('hijacked')
  })
  it('customer B cannot DELETE customer A\'s reservation', async () => {
    await expect((payload.delete as any)({ id: aRes.id, collection: 'reservations', overrideAccess: false, user: { ...custB, collection: 'customers' } })).rejects.toThrow()
    const still = await (payload.findByID as any)({ id: aRes.id, collection: 'reservations', depth: 0, disableErrors: true })
    expect(still).toBeTruthy()
  })
  it('customer B cannot read other customers\' PII through the customers collection', async () => {
    const r = await (payload.find as any)({ collection: 'customers', depth: 0, overrideAccess: false, user: { ...custB, collection: 'customers' } })
    const ids = r.docs.map((d: Doc) => String(d.id))
    expect(ids).not.toContain(String(custA.id))
  })
})

// ───────────────────────────── I-STATUS · cancellation policy (plan §4 D) ─────────────────────────────
describe('I-STATUS · cancellation notice cannot be bypassed', () => {
  it('cancelling inside the notice window is refused; outside it is allowed', async () => {
    const soon = await mk('reservations', { customer: custA.id, resource: resQ2.id, service: svc60.id, startTime: hoursFromNow(2) })
    await expect((payload.update as any)({ id: soon.id, collection: 'reservations', data: { status: sm.cancelStatus } })).rejects.toThrow()
    const later = await mk('reservations', { customer: custA.id, resource: resQ2.id, service: svc60.id, startTime: hoursFromNow(48) })
    const ok = await (payload.update as any)({ id: later.id, collection: 'reservations', data: { status: sm.cancelStatus }, depth: 0 })
    expect(ok.status).toBe(sm.cancelStatus)
  })
  it('the OWNER deleting their own reservation inside the notice window is refused (delete must not bypass the policy)', async () => {
    const soon = await mk('reservations', { customer: custA.id, resource: resQ2.id, service: svc60.id, startTime: hoursFromNow(2) })
    await expect((payload.delete as any)({ id: soon.id, collection: 'reservations', overrideAccess: false, user: { ...custA, collection: 'customers' } })).rejects.toThrow()
  })
  it('an illegal transition is refused and a terminal status is final', async () => {
    const from = Object.keys(sm.transitions).find((s) => (sm.transitions[s] ?? []).length > 0 && s !== sm.defaultStatus) ?? sm.defaultStatus
    const notAllowed = sm.statuses.find((s) => s !== from && !(sm.transitions[from] ?? []).includes(s))
    expect(notAllowed).toBeTruthy()
    const r = await mk('reservations', { customer: custA.id, resource: resQ2.id, service: svc60.id, startTime: T(9) })
    // walk into `from` legally if needed
    if (from !== sm.defaultStatus) {
      const pathTo = (sm.transitions[sm.defaultStatus] ?? []).includes(from)
      if (!pathTo) return
      await (payload.update as any)({ id: r.id, collection: 'reservations', data: { status: from } })
    }
    await expect((payload.update as any)({ id: r.id, collection: 'reservations', data: { status: notAllowed } })).rejects.toThrow()
    const terminal = sm.terminalStatuses[0]
    if (terminal && (sm.transitions[sm.defaultStatus] ?? []).includes(terminal)) {
      const r2 = await mk('reservations', { customer: custA.id, resource: resQ2.id, service: svc60.id, startTime: T(11) })
      await (payload.update as any)({ id: r2.id, collection: 'reservations', data: { status: terminal } })
      await expect((payload.update as any)({ id: r2.id, collection: 'reservations', data: { status: sm.defaultStatus } })).rejects.toThrow()
    }
  })
  it('a non-privileged caller cannot create a reservation already in a non-default status', async () => {
    const { json, status } = await callEndpoint('/reserve/book', { resource: resQ2.id, service: svc60.id, startTime: T(13), status: sm.confirmStatus }, custA)
    expect(status === 201 ? json.status : sm.defaultStatus).toBe(sm.defaultStatus)
  })
})

// ───────────────────────────── I-TIME · business timezone (plan §4 E) ─────────────────────────────
describe('I-TIME · exception days resolve in the business timezone', () => {
  it('pure: a YYYY-MM-DD exception (the README\'s documented form) blocks THAT day in America/New_York', () => {
    expect(isExceptionDate('2025-12-25', [{ date: '2025-12-25' }], TZ)).toBe(true)
    expect(isExceptionDate('2025-12-24', [{ date: '2025-12-25' }], TZ)).toBe(false)
    expect(isExceptionDate('2025-12-26', [{ date: '2025-12-25', endDate: '2025-12-26' }], TZ)).toBe(true)
    expect(isExceptionDate('2025-12-27', [{ date: '2025-12-25', endDate: '2025-12-26' }], TZ)).toBe(false)
  })
  it('dynamic: a schedule exception entered as 2025-12-25 removes slots on 2025-12-25, not on 2025-12-24', async () => {
    await mk('schedules', {
      name: 'tz-sched', active: true, resource: resTz.id, scheduleType: 'recurring',
      exceptions: [{ date: '2025-12-25' }],
      recurringSlots: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => ({ day, endTime: '17:00', startTime: '09:00' })),
    })
    const req = await asUser(null)
    const common = { blockingStatuses: sm.blockingStatuses, holdsSlug: 'reservation-holds', payload, req, reservationSlug: 'reservations', resourceId: resTz.id, resourceSlug: 'resources', scheduleSlug: 'schedules', serviceId: svc60.id, serviceSlug: 'services', timeZone: TZ }
    const closed = await getAvailableSlots({ ...common, date: '2025-12-25' })
    const open = await getAvailableSlots({ ...common, date: '2025-12-24' })
    expect(closed.slots.length).toBe(0)
    expect(open.slots.length).toBeGreaterThan(0)
  })
})

// ───────────────────────────── I-NOOVERLAP (plan §4 A) ─────────────────────────────
describe('I-NOOVERLAP · overlap boundaries and buffers', () => {
  it('touching intervals (end == start) do not conflict with zero buffers; a real overlap does', async () => {
    await mk('reservations', { customer: custA.id, resource: resOverlap.id, service: svc60.id, startTime: T(15) })   // 15:00-16:00
    const touch = await mk('reservations', { customer: custA.id, resource: resOverlap.id, service: svc60.id, startTime: T(16) }) // 16:00-17:00
    expect(touch.id).toBeTruthy()
    await expect(mk('reservations', { customer: custA.id, resource: resOverlap.id, service: svc60.id, startTime: T(15, 30) })).rejects.toThrow()
  })
  it('the EXISTING booking\'s after-buffer is enforced against a newcomer', async () => {
    await mk('reservations', { customer: custA.id, resource: resBuf.id, service: svcBufAfter15.id, startTime: T(9) })   // 09:00-10:00 +15 after
    await expect(mk('reservations', { customer: custA.id, resource: resBuf.id, service: svc60.id, startTime: T(10, 10) })).rejects.toThrow()
    const ok = await mk('reservations', { customer: custA.id, resource: resBuf.id, service: svc60.id, startTime: T(10, 15) })
    expect(ok.id).toBeTruthy()
  })
  it('the NEWCOMER\'s before-buffer is enforced against an existing booking', async () => {
    await mk('reservations', { customer: custA.id, resource: resBuf.id, service: svc60.id, startTime: T(13) })          // 13:00-14:00, no buffer
    await expect(mk('reservations', { customer: custA.id, resource: resBuf.id, service: svcBufBefore15.id, startTime: T(14, 10) })).rejects.toThrow()
    const ok = await mk('reservations', { customer: custA.id, resource: resBuf.id, service: svcBufBefore15.id, startTime: T(14, 15) })
    expect(ok.id).toBeTruthy()
  })
  it('fixed-duration endTime cannot be tampered shorter to dodge a conflict', async () => {
    const r = await mk('reservations', { customer: custA.id, endTime: T(15, 5), resource: resQ1.id, service: svcFixedTamper.id, startTime: T(15) })
    // resQ1 already holds 15:00-16:00 (svc60) from the AUTHZ block, so this must have been rejected OR bounded correctly
    const stored = await (payload.findByID as any)({ id: r.id, collection: 'reservations', depth: 0, disableErrors: true })
    if (stored) expect(new Date(stored.endTime).getTime() - new Date(stored.startTime).getTime()).toBe(60 * 60_000)
  })
})

// ───────────────────────────── I-CAPACITY (plan §4 B) ─────────────────────────────
describe('I-CAPACITY · quantity and per-guest counting', () => {
  it('per-reservation: quantity 2 admits two overlapping bookings and refuses the third', async () => {
    await mk('reservations', { customer: custA.id, resource: resQ2.id, service: svc60.id, startTime: T(18) })
    await mk('reservations', { customer: custB.id, resource: resQ2.id, service: svc60.id, startTime: T(18, 30) })
    await expect(mk('reservations', { customer: custA.id, resource: resQ2.id, service: svc60.id, startTime: T(18, 45) })).rejects.toThrow()
  })
  it('per-guest: quantity 4 sums guest counts exactly', async () => {
    await mk('reservations', { customer: custA.id, guestCount: 3, resource: resQ4guest.id, service: svc60.id, startTime: T(18) })
    await expect(mk('reservations', { customer: custB.id, guestCount: 2, resource: resQ4guest.id, service: svc60.id, startTime: T(18) })).rejects.toThrow()
    const one = await mk('reservations', { customer: custB.id, guestCount: 1, resource: resQ4guest.id, service: svc60.id, startTime: T(18) })
    expect(one.id).toBeTruthy()
  })
  it('guestCount must be a positive integer (0 and 1.5 are refused)', async () => {
    await expect(mk('reservations', { customer: custA.id, guestCount: 0, resource: resQ4guest.id, service: svc60.id, startTime: T(20) })).rejects.toThrow()
    await expect(mk('reservations', { customer: custA.id, guestCount: 1.5, resource: resQ4guest.id, service: svc60.id, startTime: T(20) })).rejects.toThrow()
  })
})

// ───────────────────────────── I-IDEMPOTENT + holds (plan §4 C) ─────────────────────────────
describe('I-IDEMPOTENT · keys and slot holds', () => {
  it('a replayed idempotencyKey never creates a second reservation', async () => {
    const key = `k-${Date.now()}`
    await mk('reservations', { customer: custA.id, idempotencyKey: key, resource: resQ2.id, service: svc60.id, startTime: T(7) })
    await expect(mk('reservations', { customer: custA.id, idempotencyKey: key, resource: resQ2.id, service: svc60.id, startTime: T(7) })).rejects.toThrow()
    const { totalDocs } = await (payload.count as any)({ collection: 'reservations', where: { idempotencyKey: { equals: key } } })
    expect(totalDocs).toBe(1)
  })
  it('a hold blocks the slot for others, converts once with its token, and cannot convert twice', async () => {
    const hold = await callEndpoint('/reserve/hold', { resource: resHold.id, service: svc60.id, startTime: T(12) })
    expect(hold.status).toBe(201)
    const token = hold.json.token
    const blocked = await callEndpoint('/reserve/book', { guest: { email: 'x@trenyx.test', name: 'X' }, resource: resHold.id, service: svc60.id, startTime: T(12) })
    expect(blocked.status).not.toBe(201)
    const converted = await callEndpoint('/reserve/book', { guest: { email: 'h@trenyx.test', name: 'Holder' }, holdToken: token, resource: resHold.id, service: svc60.id, startTime: T(12) })
    expect(converted.status).toBe(201)
    const twice = await callEndpoint('/reserve/book', { guest: { email: 'h2@trenyx.test', name: 'Holder2' }, holdToken: token, resource: resHold.id, service: svc60.id, startTime: T(12) })
    expect(twice.status).not.toBe(201)
    const release = await callEndpoint('/reserve/hold/release', { token: 'no-such-token' })
    expect(release.status).toBeLessThan(500)
  })
  it('a hold with guestCount 0 is a 400, not a 409', async () => {
    const r = await callEndpoint('/reserve/hold', { guestCount: 0, resource: resHold.id, service: svc60.id, startTime: T(6) })
    expect(r.status).toBe(400)
  })
})

// ───────────────────────────── I-ACTIVE (plan §4 F) ─────────────────────────────
describe('I-ACTIVE · inactive references are refused everywhere', () => {
  it('an inactive resource referenced only via items[] is refused', async () => {
    await expect(mk('reservations', { customer: custA.id, items: [{ resource: resQ1.id, startTime: T(22) }, { resource: resInactive.id, startTime: T(22) }], resource: resQ1.id, service: svc60.id, startTime: T(22) })).rejects.toThrow()
  })
  it('rescheduling an existing booking onto an inactive resource is refused; cancelling it stays allowed', async () => {
    const r = await mk('reservations', { customer: custA.id, resource: resQ2.id, service: svc60.id, startTime: T(23) })
    await expect((payload.update as any)({ id: r.id, collection: 'reservations', data: { resource: resInactive.id } })).rejects.toThrow()
    await (payload.update as any)({ id: resQ2.id, collection: 'resources', data: { active: false } })
    try {
      const c = await (payload.update as any)({ id: r.id, collection: 'reservations', data: { status: sm.cancelStatus }, depth: 0 })
      expect(c.status).toBe(sm.cancelStatus)
    } finally {
      await (payload.update as any)({ id: resQ2.id, collection: 'resources', data: { active: true } })
    }
  })
})

// ───────────────────────────── I-GUEST-XOR + token hygiene (plan §4 G/I) ─────────────────────────────
describe('I-GUEST-XOR · guest bookings and the cancellation token', () => {
  it('exactly one of customer / guest; a guest needs name + (email | phone)', async () => {
    await expect(mk('reservations', { customer: custA.id, guest: { email: 'g@trenyx.test', name: 'G' }, resource: resQ1.id, service: svc60.id, startTime: T(2) })).rejects.toThrow()
    await expect(mk('reservations', { resource: resQ1.id, service: svc60.id, startTime: T(3) })).rejects.toThrow()
    await expect(mk('reservations', { guest: { name: 'NoContact' }, resource: resQ1.id, service: svc60.id, startTime: T(4) })).rejects.toThrow()
  })
  it('the book response and a customer-level read never expose cancellationToken; a wrong token cannot cancel', async () => {
    const booked = await callEndpoint('/reserve/book', { guest: { email: 'tok@trenyx.test', name: 'Tok' }, resource: resQ1.id, service: svc60.id, startTime: T(5) })
    expect(booked.status).toBe(201)
    expect(booked.json.cancellationToken).toBeUndefined()
    const asCustomer = await (payload.findByID as any)({ id: booked.json.id, collection: 'reservations', depth: 0, disableErrors: true, overrideAccess: false, user: { ...custB, collection: 'customers' } })
    if (asCustomer) expect(asCustomer.cancellationToken).toBeUndefined()
    const wrong = await callEndpoint('/reserve/cancel', { reservationId: booked.json.id, token: 'not-the-token' })
    expect(wrong.status).toBe(403)
    const stored = await (payload.findByID as any)({ id: booked.json.id, collection: 'reservations', depth: 0 })
    const right = await callEndpoint('/reserve/cancel', { reservationId: booked.json.id, token: stored.cancellationToken })
    expect(right.status).toBe(200)
  })
  it('an anonymous caller cannot book as a named customer; an authenticated customer is forced onto their own id', async () => {
    const anon = await callEndpoint('/reserve/book', { customer: custA.id, resource: resQ1.id, service: svc60.id, startTime: T(6) })
    expect(anon.status).toBe(403)
    const spoof = await callEndpoint('/reserve/book', { customer: custA.id, resource: resQ1.id, service: svc60.id, startTime: T(6) }, custB)
    if (spoof.status === 201) expect(String(spoof.json.customer?.id ?? spoof.json.customer)).toBe(String(custB.id))
  })
})
