import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { labelsPlugin, MAX_LABELS } from '../src/index.js'

/** Two made-up sites. Orders, kits and batches belong to a site; a kit can be marked hidden, which its readers may not see. */
let payload: Payload
let mongo: MongoMemoryReplSet
const u: Record<string, { id: string | number; role: string; tenant?: unknown }> = {}
const t: Record<string, string | number> = {}
const id: Record<string, string | number> = {}
const pages = (b: Uint8Array) => Buffer.from(b).toString('latin1').match(/\/Type \/Page\b(?!s)/g)?.length ?? 0
const asUser = (name: string) => ({ collection: 'users', ...u[name] })

async function post(user: string | null, body: unknown) {
  const ep = payload.config.endpoints.find((e) => e.path === '/labels/print')!
  return (await ep.handler({ payload, user: user ? asUser(user) : null, json: async () => body } as never)) as Response
}
const logs = async () => (await payload.find({ collection: 'label-prints' as never, limit: 50 })).docs as unknown as Array<Record<string, unknown>>
const create = (collection: string, data: Record<string, unknown>) => payload.create({ collection: collection as never, data: data as never })

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  const own = ({ req }: { req: { user?: unknown } }) => (req.user ? { tenant: { equals: (req.user as { tenant?: unknown }).tenant } } : false)
  payload = await getPayload({
    config: await buildConfig({
      secret: 'test-secret-not-for-production',
      telemetry: false,
      typescript: { autoGenerate: false },
      db: mongooseAdapter({ url: mongo.getUri('sets'), ensureIndexes: true }),
      collections: [
        { slug: 'users', auth: true, fields: [{ name: 'role', type: 'text' }, { name: 'tenant', type: 'relationship', relationTo: 'tenants' }] },
        { slug: 'tenants', fields: [{ name: 'name', type: 'text' }] },
        { slug: 'batches', fields: [{ name: 'code', type: 'text' }, { name: 'tenant', type: 'relationship', relationTo: 'tenants' }], access: { read: own } },
        { slug: 'orders', fields: [{ name: 'code', type: 'text' }, { name: 'tenant', type: 'relationship', relationTo: 'tenants' }], access: { read: own } },
        {
          slug: 'kits',
          fields: [
            { name: 'code', type: 'text' },
            { name: 'hidden', type: 'checkbox' },
            { name: 'order', type: 'relationship', relationTo: 'orders' },
            { name: 'batch', type: 'relationship', relationTo: 'batches' },
            { name: 'tenant', type: 'relationship', relationTo: 'tenants' },
          ],
          access: { read: ({ req }) => (req.user ? { and: [{ tenant: { equals: (req.user as { tenant?: unknown }).tenant } }, { hidden: { not_equals: true } }] } : false) },
        },
      ],
      plugins: [
        labelsPlugin({
          access: { manage: ({ req }) => (req.user as { role?: string } | undefined)?.role === 'manager', print: ({ req }) => Boolean(req.user) },
          scopeField: 'tenant',
          scopeCollection: 'tenants',
          scopeOf: ({ req }) => (req.user as { tenant?: string | number } | undefined)?.tenant,
        }),
      ],
    }),
  })
  for (const n of ['a', 'b']) t[n] = (await create('tenants', { name: `Site ${n}` })).id
  for (const [n, role, tn] of [['alice', 'manager', 'a'], ['viewer', 'viewer', 'a'], ['bob', 'manager', 'b']] as const) {
    const d = await create('users', { email: `${n}@example.test`, password: 'test-pass-123', role, tenant: t[tn] })
    u[n] = { id: d.id, role, tenant: t[tn] }
  }
  const el = [{ type: 'text', x: 5, y: 5, width: 80, height: 10, fontSize: 14, content: '{{code}}' }]
  const tpl = async (key: string, collection: string, tn: string) => (await create('label-templates', { name: key, key, collection, width: 101.6, height: 152.4, elements: el, tenant: t[tn] })).id
  const tOrder = await tpl('a-order', 'orders', 'a')
  const tKit = await tpl('a-kit', 'kits', 'a')
  const tBatch = await tpl('a-batch', 'batches', 'a')
  const bKit = await tpl('b-kit', 'kits', 'b')
  id.tKit = tKit

  id.batchA = (await create('batches', { code: 'BA1', tenant: t.a })).id
  id.batchB = (await create('batches', { code: 'BB1', tenant: t.b })).id
  id.order1 = (await create('orders', { code: 'O1', tenant: t.a })).id
  id.order2 = (await create('orders', { code: 'O2', tenant: t.a })).id
  id.order3 = (await create('orders', { code: 'O3', tenant: t.a })).id
  id.orderB = (await create('orders', { code: 'OB', tenant: t.b })).id
  // order1: two kits, one batch. order2: a hidden kit. order3: a kit whose batch is on the other site.
  id.kit1 = (await create('kits', { code: 'K1', order: id.order1, batch: id.batchA, tenant: t.a })).id
  await create('kits', { code: 'K2', order: id.order1, batch: id.batchA, tenant: t.a })
  await create('kits', { code: 'K3', order: id.order2, hidden: true, tenant: t.a })
  id.kit4 = (await create('kits', { code: 'K4', order: id.order3, batch: id.batchB, tenant: t.a })).id

  const all = { name: 'All for an order', key: 'order-all', collection: 'orders', tenant: t.a, steps: [{ template: tOrder, via: 'self' }, { template: tKit, via: 'backward', collection: 'kits', field: 'order' }, { template: tBatch, via: 'forward', field: 'batch', from: 2 }] }
  await create('label-sets', all)
  await create('label-sets', { name: 'Kit and order', key: 'kit-order', collection: 'kits', tenant: t.a, steps: [{ template: tKit, via: 'self' }, { template: tOrder, via: 'forward', field: 'order' }] })
  await create('label-sets', { name: 'Other site', key: 'b-set', collection: 'orders', tenant: t.b, steps: [{ template: bKit, via: 'backward', collection: 'kits', field: 'order' }] })
  // A set on site b that names site a's template: bob must not be able to use that template.
  await create('label-sets', { name: 'Borrowed', key: 'b-borrow', collection: 'orders', tenant: t.b, steps: [{ template: tOrder, via: 'self' }] })
  // A set that names a template on the wrong collection.
  await create('label-sets', { name: 'Wrong', key: 'wrong', collection: 'orders', tenant: t.a, steps: [{ template: tBatch, via: 'self' }] })
})
afterAll(async () => {
  await payload?.db.destroy?.()
  await mongo?.stop()
})

describe('print sets', () => {
  it('chains a self, a backward and a forward step into one PDF and writes one log entry', async () => {
    const before = (await logs()).length
    const res = await post('alice', { set: 'order-all', id: id.order1 })
    expect(res.status).toBe(200)
    // the order, its two kits, and the one batch both kits share
    expect(pages(new Uint8Array(await res.arrayBuffer()))).toBe(4)
    const after = await logs()
    expect(after.length).toBe(before + 1)
    const entry = after.at(-1)!
    expect(entry.labelCount).toBe(4)
    expect(entry.documentIds).toEqual([String(id.order1)])
    expect(JSON.stringify(entry)).not.toContain('K1')
  })

  it('reaches a record forward through a relationship field', async () => {
    const res = await post('alice', { set: 'kit-order', id: id.kit1 })
    expect(res.status).toBe(200)
    expect(pages(new Uint8Array(await res.arrayBuffer()))).toBe(2)
  })

  it('applies copies across the whole set and refuses over the cap with the number', async () => {
    const ok = await post('alice', { set: 'order-all', id: id.order1, copies: 2 })
    expect(pages(new Uint8Array(await ok.arrayBuffer()))).toBe(8)
    const before = (await logs()).length
    const res = await post('alice', { set: 'order-all', id: id.order1, copies: 501 })
    expect(res.status).toBe(413)
    expect((await res.json()).message).toContain(`${4 * 501}`)
    expect(MAX_LABELS).toBe(2000)
    expect((await logs()).length).toBe(before)
  })

  it("refuses another site's set, a borrowed template, and another site's starting record", async () => {
    const before = (await logs()).length
    expect((await post('alice', { set: 'b-set', id: id.orderB })).status).toBe(403)
    expect((await post('bob', { set: 'order-all', id: id.order1 })).status).toBe(403)
    // bob's own set names a template of site a
    expect((await post('bob', { set: 'b-borrow', id: id.orderB })).status).toBe(403)
    // alice's set, a record of site b
    expect((await post('alice', { set: 'order-all', id: id.orderB })).status).toBe(403)
    expect((await logs()).length).toBe(before)
  })

  it('refuses the whole run when a record cannot be read, backward or forward, and logs nothing', async () => {
    const before = (await logs()).length
    const hidden = await post('alice', { set: 'order-all', id: id.order2 })
    expect(hidden.status).toBe(403)
    expect((await hidden.json()).message).toContain('Nothing was printed')
    // order3's kit points at a batch of the other site
    expect((await post('alice', { set: 'order-all', id: id.order3 })).status).toBe(403)
    expect((await logs()).length).toBe(before)
  })

  it('refuses a step whose template prints from another collection, signed-out requests, and bad requests', async () => {
    expect((await post('alice', { set: 'wrong', id: id.order1 })).status).toBe(422)
    expect((await post(null, { set: 'order-all', id: id.order1 })).status).toBe(401)
    expect((await post('alice', { set: 'order-all' })).status).toBe(400)
    expect((await post('alice', { set: 'order-all', template: 'a-kit', id: id.order1 })).status).toBe(400)
    expect((await post('alice', { set: 'nope', id: id.order1 })).status).toBe(403)
  })
})

describe('the label-sets collection', () => {
  const as = (user: string) => ({ user: asUser(user) as never, overrideAccess: false })
  const data = (tn: string) => ({ name: 'New', key: `new-${Math.random()}`, collection: 'orders', tenant: t[tn], steps: [{ template: id.tKit, via: 'self' }] }) as never

  it('lets a manager create in their own site only, and refuses everyone else', async () => {
    await expect(payload.create({ collection: 'label-sets' as never, data: data('a'), ...as('alice') })).resolves.toBeDefined()
    await expect(payload.create({ collection: 'label-sets' as never, data: data('b'), ...as('alice') })).rejects.toThrow()
    await expect(payload.create({ collection: 'label-sets' as never, data: data('a'), ...as('viewer') })).rejects.toThrow()
  })

  it('refuses a non-manager changing or deleting a set, and hides the other site', async () => {
    const mine = (await payload.find({ collection: 'label-sets' as never, where: { key: { equals: 'order-all' } } as never, ...as('alice') })).docs[0] as { id: string }
    await expect(payload.update({ collection: 'label-sets' as never, id: mine.id, data: { name: 'x' } as never, ...as('viewer') })).rejects.toThrow()
    await expect(payload.delete({ collection: 'label-sets' as never, id: mine.id, ...as('viewer') })).rejects.toThrow()
    await expect(payload.update({ collection: 'label-sets' as never, id: mine.id, data: { name: 'x' } as never, ...as('bob') })).rejects.toThrow()
    const keys = (await payload.find({ collection: 'label-sets' as never, limit: 50, ...as('bob') })).docs.map((d) => (d as { key: string }).key)
    expect(keys).not.toContain('order-all')
    expect(keys).toContain('b-set')
  })
})
