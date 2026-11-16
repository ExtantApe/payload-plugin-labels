import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ALL_SCOPES, labelsPlugin, MAX_LABELS } from '../src/index.js'
import { findTemplate } from '../src/print.js'

/** Two made-up sites. Orders are readable only by users of their own site, so the print route must follow that. */
let payload: Payload
let mongo: MongoMemoryReplSet
const u: Record<string, { id: string | number; role: string; tenant?: unknown }> = {}
const t: Record<string, string | number> = {}
const orders: Record<string, string | number> = {}
const pages = (b: Uint8Array) => Buffer.from(b).toString('latin1').match(/\/Type \/Page\b(?!s)/g)?.length ?? 0

async function post(user: string | null, body: unknown) {
  const ep = payload.config.endpoints.find((e) => e.path === '/labels/print')!
  const req = { payload, user: user ? { collection: 'users', ...u[user] } : null, json: async () => body } as never
  return (await ep.handler(req)) as Response
}
const logs = async () => (await payload.find({ collection: 'label-prints' as never, limit: 50 })).docs as unknown as Array<Record<string, unknown>>

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  payload = await getPayload({
    config: await buildConfig({
      secret: 'test-secret-not-for-production',
      telemetry: false,
      typescript: { autoGenerate: false },
      db: mongooseAdapter({ url: mongo.getUri('print'), ensureIndexes: true }),
      collections: [
        { slug: 'users', auth: true, fields: [{ name: 'role', type: 'text' }, { name: 'tenant', type: 'relationship', relationTo: 'tenants' }] },
        { slug: 'tenants', fields: [{ name: 'name', type: 'text' }] },
        {
          slug: 'orders',
          fields: [{ name: 'code', type: 'text' }, { name: 'tenant', type: 'relationship', relationTo: 'tenants' }],
          access: { read: ({ req }) => (req.user ? { tenant: { equals: (req.user as { tenant?: unknown }).tenant } } : false) },
        },
      ],
      plugins: [
        labelsPlugin({
          access: { manage: ({ req }) => Boolean(req.user) },
          scopeField: 'tenant',
          scopeCollection: 'tenants',
          scopeOf: ({ req }) => {
            const user = req.user as { role?: string; tenant?: string | number } | undefined
            return user?.role === 'platform' ? ALL_SCOPES : user?.tenant
          },
        }),
      ],
    }),
  })
  for (const n of ['a', 'b']) t[n] = (await payload.create({ collection: 'tenants', data: { name: `Site ${n}` } })).id
  for (const [n, role, tn] of [['alice', 'staff', 'a'], ['bob', 'staff', 'b'], ['drifter', 'staff', undefined]] as const) {
    const d = await payload.create({ collection: 'users', data: { email: `${n}@example.test`, password: 'test-pass-123', role, ...(tn ? { tenant: t[tn] } : {}) } as never })
    u[n] = { id: d.id, role, tenant: tn ? t[tn] : undefined }
  }
  const el = [{ type: 'text', x: 5, y: 5, width: 80, height: 10, fontSize: 14, content: '{{code}} {{label.number}}/{{label.of}}' }, { type: 'barcode', x: 5, y: 20, width: 60, height: 20, symbology: 'code128', value: '{{code}}' }]
  const base = { collection: 'orders', width: 101.6, height: 152.4, elements: el }
  await payload.create({ collection: 'label-templates' as never, data: { ...base, name: 'A box', key: 'a-box', tenant: t.a } as never })
  await payload.create({ collection: 'label-templates' as never, data: { ...base, name: 'B box', key: 'b-box', tenant: t.b } as never })
  await payload.create({ collection: 'label-templates' as never, data: { collection: 'orders', width: 60, height: 20, elements: el, name: 'A small', key: 'a-small', tenant: t.a } as never })
  const sheet = { page: { width: 215.9, height: 279.4 }, columns: 2, rows: 2, width: 90, height: 50, top: 10, left: 10, pitchX: 100, pitchY: 60 }
  const m1 = await payload.create({ collection: 'label-media' as never, data: { name: 'Mine', key: 'a-sheet', kind: 'sheet', definition: sheet, tenant: t.a } as never })
  await payload.create({ collection: 'label-media' as never, data: { name: 'Other', key: 'b-sheet', kind: 'sheet', definition: sheet, tenant: t.b } as never })
  await payload.create({ collection: 'label-media' as never, data: { name: 'Broken', key: 'broken', kind: 'sheet', definition: { ...sheet, columns: 9 }, tenant: t.a } as never })
  await payload.create({ collection: 'label-templates' as never, data: { collection: 'orders', width: 60, height: 20, elements: el, name: 'A own media', key: 'a-own', media: m1.id, tenant: t.a } as never })
  for (const [k, tn] of [['a1', 'a'], ['a2', 'a'], ['b1', 'b']] as const) orders[k] = (await payload.create({ collection: 'orders' as never, data: { code: k.toUpperCase(), tenant: t[tn] } as never })).id
})
afterAll(async () => {
  await payload?.db.destroy?.()
  await mongo?.stop()
})

describe('POST /labels/print', () => {
  it('returns a PDF with one page per label and writes one log entry with ids and counts only', async () => {
    const before = (await logs()).length
    const r = await post('alice', { template: 'a-box', ids: [orders.a1, orders.a2], copies: 2 })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/pdf')
    expect(pages(new Uint8Array(await r.arrayBuffer()))).toBe(4)
    const all = await logs()
    expect(all).toHaveLength(before + 1)
    const entry = all.at(-1)!
    expect(entry).toMatchObject({ labelCount: 4, collection: 'orders', printedBy: String(u.alice!.id) })
    expect(entry.documentIds).toEqual([String(orders.a1), String(orders.a2)])
    expect(JSON.stringify(entry)).not.toMatch(/A1|A2/)
  })
  it(`refuses more than ${MAX_LABELS} labels with the number, and logs nothing`, async () => {
    const before = (await logs()).length
    const r = await post('alice', { template: 'a-box', ids: [orders.a1, orders.a2], copies: 1000 })
    expect(r.status).toBe(200)
    const over = await post('alice', { template: 'a-box', ids: [orders.a1, orders.a2], copies: 1001 })
    expect(over.status).toBe(413)
    expect(((await over.json()) as { message: string }).message).toContain('2002')
    expect((await logs()).length).toBe(before + 1)
  })
  it('refuses a signed-out request and a person with no site', async () => {
    expect((await post(null, { template: 'a-box', ids: [orders.a1] })).status).toBe(401)
    expect((await post('drifter', { template: 'a-box', ids: [orders.a1] })).status).toBe(403)
  })
  it("refuses another site's template, and a record the person cannot read, printing nothing", async () => {
    const before = (await logs()).length
    expect((await post('alice', { template: 'b-box', ids: [orders.a1] })).status).toBe(403)
    expect((await post('alice', { template: 'a-box', ids: [orders.a1, orders.b1] })).status).toBe(403)
    expect((await post('alice', { template: 'a-box', ids: [orders.a1, '000000000000000000000000'] })).status).toBe(403)
    expect((await logs()).length).toBe(before)
  })
  it('refuses bad requests plainly', async () => {
    expect((await post('alice', { ids: [orders.a1] })).status).toBe(400)
    expect((await post('alice', { template: 'a-box', ids: [] })).status).toBe(400)
    expect((await post('alice', { template: 'a-box', ids: [orders.a1], copies: 0 })).status).toBe(400)
    expect((await post('alice', { template: 'a-box', ids: [orders.a1], copies: 1.5 })).status).toBe(400)
  })
  it('the log cannot be written through the API', async () => {
    await expect(payload.create({ collection: 'label-prints' as never, data: { collection: 'orders', tenant: t.a } as never, user: { collection: 'users', ...u.alice } as never, overrideAccess: false })).rejects.toThrow()
  })

  it('looks a template up by key first, then by the id exactly as given', async () => {
    const calls: string[] = []
    const fake = {
      find: async (a: { where: { key: { equals: string } } }) => {
        calls.push(`find:${a.where.key.equals}`)
        return { docs: a.where.key.equals === 'known-key' ? [{ id: 7, key: 'known-key' }] : [] }
      },
      findByID: async (a: { id: string; overrideAccess: boolean }) => {
        calls.push(`id:${a.id}:${a.overrideAccess}`)
        if (a.id === '42') return { id: 42, key: 'numeric' }
        throw new Error('not found')
      },
    }
    expect((await findTemplate(fake as never, 'label-templates', 'known-key', {}))?.id).toBe(7)
    expect((await findTemplate(fake as never, 'label-templates', '42', {}))?.id).toBe(42)
    expect(await findTemplate(fake as never, 'label-templates', '99', {})).toBeUndefined()
    expect(calls).toEqual(['find:known-key', 'find:42', 'id:42:false', 'find:99', 'id:99:false'])
  })
})

describe('POST /labels/print with media and a start slot', () => {
  const j = async (r: Response) => ((await r.json()) as { message: string }).message
  it('prints on an Avery sheet from the start slot and flows onto a second page', async () => {
    const r = await post('alice', { template: 'a-small', ids: [orders.a1], copies: 2, media: 'avery-5160', start: 30 })
    expect(r.status).toBe(200)
    expect(pages(new Uint8Array(await r.arrayBuffer()))).toBe(2)
    const one = await post('alice', { template: 'a-small', ids: [orders.a1, orders.a2], media: 'avery-5160', start: 2 })
    expect(pages(new Uint8Array(await one.arrayBuffer()))).toBe(1)
  })
  it("uses the template's own media when none is named, and a site's own stored media by key", async () => {
    const own = await post('alice', { template: 'a-own', ids: [orders.a1, orders.a2], copies: 2, start: 4 })
    expect(own.status).toBe(200)
    expect(pages(new Uint8Array(await own.arrayBuffer()))).toBe(2)
    expect((await post('alice', { template: 'a-small', ids: [orders.a1], media: 'a-sheet' })).status).toBe(200)
  })
  it('refuses bad media and start slots with a plain message', async () => {
    const ask = (extra: object) => post('alice', { template: 'a-small', ids: [orders.a1], ...extra })
    expect(await j(await ask({ media: 'avery-5160', start: 31 }))).toMatch(/1 to 30/)
    for (const start of [0, -1, 1.5, '3']) expect((await ask({ media: 'avery-5160', start })).status).toBe(400)
    expect(await j(await ask({ start: 2 }))).toMatch(/only applies to sheet/)
    expect(await j(await ask({ media: 'nope' }))).toMatch(/does not exist/)
    expect(await j(await ask({ media: 'broken' }))).toMatch(/off the page/)
    expect((await ask({ media: { a: 1 } })).status).toBe(400)
    expect(await j(await post('alice', { template: 'a-box', ids: [orders.a1], media: 'avery-5160' }))).toMatch(/larger than the labels/)
  })
  it("refuses another site's media and logs nothing for any refusal", async () => {
    const before = (await logs()).length
    expect((await post('alice', { template: 'a-small', ids: [orders.a1], media: 'b-sheet' })).status).toBe(400)
    expect((await post('alice', { template: 'a-small', ids: [orders.a1], media: 'avery-5160', start: 99 })).status).toBe(400)
    expect(await logs()).toHaveLength(before)
  })
})
