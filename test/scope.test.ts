import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ALL_SCOPES, labelsPlugin } from '../src/index.js'

/** Two made-up sites, a user in each, a platform admin, a user with no site, and one template shared by all. */
let payload: Payload
let mongo: MongoMemoryReplSet
const u: Record<string, { id: string | number; role: string; tenant?: unknown }> = {}
const t: Record<string, string | number> = {}
const tpl = (key: string, tenant?: string | number) => ({ name: key, key, collection: 'orders', width: 100, height: 50, ...(tenant ? { tenant } : {}) })
const as = (user: string) => ({ user: { collection: 'users', ...u[user] } as never, overrideAccess: false })
const keys = async (user: string, collection = 'label-templates') =>
  (await payload.find({ collection: collection as never, limit: 50, ...as(user) })).docs.map((d) => (d as { key?: string; name?: string }).key ?? '').sort()

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  payload = await getPayload({
    config: await buildConfig({
      secret: 'test-secret-not-for-production',
      telemetry: false,
      typescript: { autoGenerate: false },
      db: mongooseAdapter({ url: mongo.getUri('labels'), ensureIndexes: true }),
      collections: [
        { slug: 'users', auth: true, fields: [{ name: 'role', type: 'text' }, { name: 'tenant', type: 'relationship', relationTo: 'tenants' }] },
        { slug: 'tenants', fields: [{ name: 'name', type: 'text' }] },
      ],
      plugins: [
        labelsPlugin({
          access: { manage: ({ req }) => Boolean(req.user), print: ({ req }) => Boolean(req.user) },
          scopeField: 'tenant',
          scopeCollection: 'tenants',
          scopeOf: ({ req }) => {
            const user = req.user as { role?: string; tenant?: { id?: string | number } | string | number } | undefined
            if (user?.role === 'platform') return ALL_SCOPES
            const tn = user?.tenant
            return typeof tn === 'object' ? tn?.id : tn
          },
        }),
      ],
    }),
  })
  for (const n of ['a', 'b']) t[n] = (await payload.create({ collection: 'tenants', data: { name: `Site ${n}` } })).id
  for (const [n, role, tn] of [['alice', 'staff', 'a'], ['bob', 'staff', 'b'], ['root', 'platform', undefined], ['drifter', 'staff', undefined]] as const) {
    const doc = await payload.create({ collection: 'users', data: { email: `${n}@example.test`, password: 'test-pass-123', role, ...(tn ? { tenant: t[tn] } : {}) } as never })
    u[n] = { id: doc.id, role, tenant: tn ? t[tn] : undefined }
  }
  for (const [key, tn] of [['a-box', 'a'], ['b-box', 'b'], ['shared', undefined]] as const) await payload.create({ collection: 'label-templates' as never, data: tpl(key, tn ? t[tn] : undefined) as never })
  await payload.create({ collection: 'label-prints' as never, data: { collection: 'orders', labelCount: 2, tenant: t.a } as never })
  await payload.create({ collection: 'label-prints' as never, data: { collection: 'orders', labelCount: 1, tenant: t.b } as never })
})
afterAll(async () => {
  await payload?.db.destroy?.()
  await mongo?.stop()
})

describe('scope isolation', () => {
  it('each site reads its own templates and the shared one', async () => {
    expect(await keys('alice')).toEqual(['a-box', 'shared'])
    expect(await keys('bob')).toEqual(['b-box', 'shared'])
  })
  it('the platform admin reads everything', async () => {
    expect(await keys('root')).toEqual(['a-box', 'b-box', 'shared'])
  })
  it('a user with no scope reads nothing, and a signed-out request is refused', async () => {
    await expect(keys('drifter')).rejects.toThrow()
    await expect(payload.find({ collection: 'label-templates' as never, overrideAccess: false })).rejects.toThrow()
  })
  it('cannot create in another scope, or in no scope', async () => {
    await expect(payload.create({ collection: 'label-templates' as never, data: tpl('x1', t.b) as never, ...as('alice') })).rejects.toThrow()
    await expect(payload.create({ collection: 'label-templates' as never, data: tpl('x2') as never, ...as('alice') })).rejects.toThrow()
    const ok = await payload.create({ collection: 'label-templates' as never, data: tpl('a-two', t.a) as never, ...as('alice') })
    expect((ok as unknown as { key: string }).key).toBe('a-two')
  })
  it('cannot update or delete another scope, nor the shared template, nor move a record out', async () => {
    const b = (await payload.find({ collection: 'label-templates' as never, where: { key: { equals: 'b-box' } } as never })).docs[0]!
    const shared = (await payload.find({ collection: 'label-templates' as never, where: { key: { equals: 'shared' } } as never })).docs[0]!
    const mine = (await payload.find({ collection: 'label-templates' as never, where: { key: { equals: 'a-box' } } as never })).docs[0]!
    await expect(payload.update({ collection: 'label-templates' as never, id: b.id, data: { name: 'hijack' } as never, ...as('alice') })).rejects.toThrow()
    await expect(payload.delete({ collection: 'label-templates' as never, id: b.id, ...as('alice') })).rejects.toThrow()
    await expect(payload.update({ collection: 'label-templates' as never, id: shared.id, data: { name: 'edit' } as never, ...as('alice') })).rejects.toThrow()
    await expect(payload.update({ collection: 'label-templates' as never, id: mine.id, data: { tenant: t.b } as never, ...as('alice') })).rejects.toThrow()
    expect(((await payload.findByID({ collection: 'label-templates' as never, id: b.id })) as unknown as { name: string }).name).toBe('b-box')
  })
  it('the platform admin can manage the shared template', async () => {
    const shared = (await payload.find({ collection: 'label-templates' as never, where: { key: { equals: 'shared' } } as never })).docs[0]!
    await payload.update({ collection: 'label-templates' as never, id: shared.id, data: { notes: 'ok' } as never, ...as('root') })
  })
  it('media follows the same rules', async () => {
    const m = (tn?: string | number) => ({ name: 'm', kind: 'thermal', definition: {}, ...(tn ? { tenant: tn } : {}) })
    await expect(payload.create({ collection: 'label-media' as never, data: m(t.b) as never, ...as('alice') })).rejects.toThrow()
    await payload.create({ collection: 'label-media' as never, data: m(t.a) as never, ...as('alice') })
    expect((await payload.find({ collection: 'label-media' as never, ...as('bob') })).totalDocs).toBe(0)
  })
  it('the print log is read in scope and never written through the API', async () => {
    expect((await payload.find({ collection: 'label-prints' as never, ...as('alice') })).docs.map((d) => (d as unknown as { labelCount: number }).labelCount)).toEqual([2])
    expect((await payload.find({ collection: 'label-prints' as never, ...as('root') })).totalDocs).toBe(2)
    for (const user of ['alice', 'root']) {
      await expect(payload.create({ collection: 'label-prints' as never, data: { collection: 'orders', tenant: t.a } as never, ...as(user) })).rejects.toThrow()
    }
  })
})
