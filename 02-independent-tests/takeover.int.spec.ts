/**
 * trenyx-verify-004 — follow-up probe requested by the independent refuter of F1:
 * with Payload's default `update: Boolean(user)` on the plugin-created standalone `customers`
 * auth collection, can a logged-in customer change ANOTHER customer's password (account takeover)?
 * Also: can they read another customer's email/phone via findByID, and can they change email?
 * Run exactly like blind.int.spec.ts (copied into <clone>/dev/trenyx-verify/ then removed).
 */
import type { Payload } from 'payload'

import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig, getPayload } from 'payload'
import { payloadReserve } from 'payload-reserve'
import sharp from 'sharp'
import { fileURLToPath } from 'url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { testDbUri } from '../helpers/testDbUri.js'
import { testEmailAdapter } from '../helpers/testEmailAdapter.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))
let payload: Payload
let stop: () => Promise<void>
let custA: any, custB: any

beforeAll(async () => {
  const db = await testDbUri('trenyx004takeover')
  const config = await buildConfig({
    admin: { importMap: { baseDir: path.resolve(dirname, '..') }, user: 'users' },
    collections: [
      { slug: 'users', auth: true, fields: [] },
      { slug: 'media', fields: [], upload: { staticDir: path.resolve(dirname, '..', 'media') } },
    ],
    db: mongooseAdapter({ ensureIndexes: true, url: db.uri }),
    editor: lexicalEditor(),
    email: testEmailAdapter,
    plugins: [payloadReserve({})],   // the Quick Start: no options at all
    secret: 'trenyx-004-takeover',
    sharp,
    typescript: { autoGenerate: false },
  })
  payload = await getPayload({ config })
  stop = async () => { await payload.destroy(); await db.stop() }
  custA = await (payload.create as any)({ collection: 'customers', data: { email: 'victim@trenyx.test', firstName: 'Vic', lastName: 'Tim', password: 'original-pw-1', phone: '+1-555-0100' }, depth: 0 })
  custB = await (payload.create as any)({ collection: 'customers', data: { email: 'attacker@trenyx.test', firstName: 'Att', lastName: 'Acker', password: 'attacker-pw-1' }, depth: 0 })
}, 120_000)

afterAll(async () => { await stop?.() })

describe('F1 follow-up · customer-to-customer account access (Quick Start config)', () => {
  const asB = () => ({ ...custB, collection: 'customers' })

  it('customer B can read customer A\'s contact details by id (expected: refused)', async () => {
    const doc = await (payload.findByID as any)({ id: custA.id, collection: 'customers', depth: 0, disableErrors: true, overrideAccess: false, user: asB() })
    expect(doc).toBeFalsy()
  })

  it('customer B cannot change customer A\'s password (expected: refused; if this passes B logs in as A)', async () => {
    await expect((payload.update as any)({ id: custA.id, collection: 'customers', data: { password: 'owned-by-b-1' }, overrideAccess: false, user: asB() })).rejects.toThrow()
    // Ground truth either way: can the NEW password log in as A?
    let loginOk = false
    try {
      const r = await (payload.login as any)({ collection: 'customers', data: { email: 'victim@trenyx.test', password: 'owned-by-b-1' } })
      loginOk = Boolean(r?.token)
    } catch { loginOk = false }
    expect(loginOk).toBe(false)
  })

  it('customer B cannot change customer A\'s email (expected: refused)', async () => {
    await expect((payload.update as any)({ id: custA.id, collection: 'customers', data: { email: 'hijacked@trenyx.test' }, overrideAccess: false, user: asB() })).rejects.toThrow()
    const a = await (payload.findByID as any)({ id: custA.id, collection: 'customers', depth: 0 })
    expect(a.email).toBe('victim@trenyx.test')
  })
})
