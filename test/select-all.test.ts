import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { labelsPlugin, MAX_LABELS } from '../src/index.js'

/** Two made-up sites. Site a has 25 orders (more than one admin page), site b has 4. Orders are readable only within a site. */
let payload: Payload
let mongo: MongoMemoryReplSet
const u: Record<string, { id: string | number; tenant?: unknown }> = {}
const t: Record<string, string | number> = {}
const pages = (b: Uint8Array) => Buffer.from(b).toString('latin1').match(/\/Type \/Page\b(?!s)/g)?.length ?? 0
const post = async (user: string | null, body: unknown) => {
  const ep = payload.config.endpoints.find((e) => e.path === '/labels/print')!
  return (await ep.handler({ payload, user: user ? { collection: 'users', ...u[user] } : null, json: async () => body } as never)) as Response
}
const newest = async () => (await payload.find({ collection: 'label-prints' as never, sort: '-createdAt', limit: 1 })).docs[0] as unknown as { documentIds: string[]; labelCount: number }
const logCount = async () => (await payload.count({ collection: 'label-prints' as never })).totalDocs
const message = async (r: Response) => ((await r.json()) as { message: string }).message
const match = (where?: object, extra: object = {}) => ({ collection: 'orders', ...(where ? { where } : {}), ...extra })

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  payload = await getPayload({
    config: await buildConfig({
      secret: 'test-secret-not-for-production',
      telemetry: false,
      typescript: { autoGenerate: false },
      db: mongooseAdapter({ url: mongo.getUri('selectall'), ensureIndexes: true }),
      collections: [
        { slug: 'users', auth: true, fields: [{ name: 'tenant', type: 'relationship', relationTo: 'tenants' }] },
        { slug: 'tenants', fields: [{ name: 'name', type: 'text' }] },
        { slug: 'kits', fields: [{ name: 'code', type: 'text' }] },
        {
          slug: 'orders',
          fields: [{ name: 'code', type: 'text' }, { name: 'tenant', type: 'relationship', relationTo: 'tenants' }, { name: 'secret', type: 'text', access: { read: () => false } }],
          access: { read: ({ req }) => (req.user ? { tenant: { equals: (req.user as { tenant?: unknown }).tenant } } : false) },
        },
      ],
      plugins: [labelsPlugin({ access: { manage: ({ req }) => Boolean(req.user) }, scopeField: 'tenant', scopeCollection: 'tenants', scopeOf: ({ req }) => (req.user as { tenant?: string | number } | undefined)?.tenant })],
    }),
  })
  for (const n of ['a', 'b']) t[n] = (await payload.create({ collection: 'tenants', data: { name: `Site ${n}` } })).id
  for (const [n, tn] of [['alice', 'a'], ['bob', 'b'], ['drifter', undefined]] as const) {
    const d = await payload.create({ collection: 'users', data: { email: `${n}@example.test`, password: 'test-pass-123', ...(tn ? { tenant: t[tn] } : {}) } as never })
    u[n] = { id: d.id, tenant: tn ? t[tn] : undefined }
  }
  const el = [{ type: 'text', x: 5, y: 5, width: 80, height: 10, fontSize: 14, content: '{{code}}' }]
  await payload.create({ collection: 'label-templates' as never, data: { collection: 'orders', width: 60, height: 20, elements: el, name: 'A small', key: 'a-small', tenant: t.a } as never })
  await payload.create({ collection: 'label-templates' as never, data: { collection: 'orders', width: 60, height: 20, elements: el, name: 'B small', key: 'b-small', tenant: t.b } as never })
  await payload.create({ collection: 'label-templates' as never, data: { collection: 'kits', width: 60, height: 20, elements: el, name: 'Kit', key: 'a-kit', tenant: t.a } as never })
  for (let i = 1; i <= 25; i++) await payload.create({ collection: 'orders' as never, data: { code: `A${String(i).padStart(2, '0')}${i % 5 === 0 ? '-rush' : ''}`, tenant: t.a, secret: 'hidden' } as never })
  for (let i = 1; i <= 4; i++) await payload.create({ collection: 'orders' as never, data: { code: `B${i}`, tenant: t.b } as never })
})
afterAll(async () => {
  await payload?.db.destroy?.()
  await mongo?.stop()
})

describe('POST /labels/print with match (select all across pages)', () => {
  it('prints every matching document, past the first admin page, and only the ones the person can read', async () => {
    const r = await post('alice', { template: 'a-small', match: match() })
    expect(r.status).toBe(200)
    expect(r.headers.get('X-Label-Count')).toBe('25')
    expect(r.headers.get('X-Document-Count')).toBe('25')
    expect(pages(new Uint8Array(await r.arrayBuffer()))).toBe(25)
    const log = await newest()
    expect(log.labelCount).toBe(25)
    expect(log.documentIds).toHaveLength(25)
    const other = await post('bob', { template: 'b-small', match: match() })
    expect(pages(new Uint8Array(await other.arrayBuffer()))).toBe(4)
  })
  it('applies the same filter the list used, multiplies by copies, and keeps the list order', async () => {
    const r = await post('alice', { template: 'a-small', copies: 2, match: match({ code: { like: 'rush' } }, { sort: '-code' }) })
    expect(r.status).toBe(200)
    expect(pages(new Uint8Array(await r.arrayBuffer()))).toBe(10)
    const log = await newest()
    expect(log.labelCount).toBe(10)
    expect(log.documentIds).toHaveLength(5)
    const codes = (await payload.find({ collection: 'orders' as never, where: { id: { in: log.documentIds } } as never, limit: 10, sort: '-code', overrideAccess: true })).docs.map((d) => String((d as { id: unknown }).id))
    expect(log.documentIds).toEqual(codes)
  })
  it("never reaches another site's documents, even when the filter asks for them", async () => {
    const r = await post('alice', { template: 'a-small', match: match({ tenant: { equals: t.b } }) })
    expect(r.status).toBe(422)
    expect(await message(r)).toMatch(/No documents match/)
    const all = await post('alice', { template: 'a-small', match: match({ or: [{ tenant: { equals: t.b } }, { code: { like: 'B' } }] }) })
    expect(all.status).toBe(422)
  })
  it('refuses over the label cap with the same message as ids, and prints nothing', async () => {
    const before = await logCount()
    const copies = Math.ceil(MAX_LABELS / 25) + 1
    const viaMatch = await post('alice', { template: 'a-small', copies, match: match() })
    const viaIds = await post('alice', { template: 'a-small', copies, ids: Array.from({ length: 25 }, (_, i) => String(i)) })
    expect(viaMatch.status).toBe(413)
    expect(await message(viaMatch)).toBe(`That is ${25 * copies} labels. One request prints at most ${MAX_LABELS}.`)
    expect(await message(viaIds)).toBe(`That is ${25 * copies} labels. One request prints at most ${MAX_LABELS}.`)
    expect(await logCount()).toBe(before)
  })
  it('sorts on a readable field, and refuses a sort or filter on a field the person cannot read', async () => {
    expect((await post('alice', { template: 'a-small', match: match(undefined, { sort: 'code' }) })).status).toBe(200)
    const before = await logCount()
    for (const m of [match(undefined, { sort: 'secret' }), match(undefined, { sort: '-secret' }), match({ secret: { like: 'h' } }), match({ or: [{ code: { like: 'A' } }, { secret: { like: 'h' } }] })]) {
      const r = await post('alice', { template: 'a-small', match: m })
      expect(r.status).toBe(400)
      expect(await message(r)).toMatch(/could not be used/)
    }
    expect(await logCount()).toBe(before)
  })
  it('refuses bad requests with plain messages and logs nothing', async () => {
    const before = await logCount()
    const ask = (body: object, user = 'alice') => post(user, { template: 'a-small', ...body })
    expect((await ask({ ids: ['x'], match: match() })).status).toBe(400)
    expect((await ask({ match: 'orders' })).status).toBe(400)
    expect((await ask({ match: { where: {} } })).status).toBe(400)
    expect((await ask({ match: match([] as never) })).status).toBe(400)
    expect((await ask({ match: match({}, { sort: 5 }) })).status).toBe(400)
    expect((await ask({ match: { collection: 'kits' } })).status).toBe(422)
    expect((await ask({ match: match({ nonsense: { equals: 1 } }) })).status).toBe(400)
    expect((await ask({ match: match({ secret: { equals: 'hidden' } }) })).status).toBe(400)
    expect((await post('alice', { set: 'x', id: '1', match: match() })).status).toBe(400)
    expect((await ask({ match: match() }, 'bob')).status).toBe(403)
    expect((await post('drifter', { template: 'a-small', match: match() })).status).toBe(403)
    expect((await post(null, { template: 'a-small', match: match() })).status).toBe(401)
    expect(await logCount()).toBe(before)
  })
})
