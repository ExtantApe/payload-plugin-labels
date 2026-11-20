import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { labelsPlugin, MEDIA_PRESETS } from '../src/index.js'

const sheet = { page: { width: 215.9, height: 279.4 }, columns: 2, rows: 2, width: 90, height: 50, top: 10, left: 10, pitchX: 100, pitchY: 60 }
const make = async (uri: string, scoped: boolean) =>
  getPayload({
    config: await buildConfig({
      secret: 'test-secret-not-for-production',
      telemetry: false,
      typescript: { autoGenerate: false },
      db: mongooseAdapter({ url: uri, ensureIndexes: true }),
      collections: [{ slug: 'users', auth: true, fields: [] }, { slug: 'tenants', fields: [{ name: 'name', type: 'text' }] }],
      plugins: [labelsPlugin({ access: { manage: () => true }, ...(scoped ? { scopeField: 'tenant', scopeCollection: 'tenants', scopeOf: () => '*' as const } : {}) })],
    }),
  })
const media = (key: string | undefined, extra: object = {}) => ({ name: `Sheet ${key ?? 'none'}`, ...(key !== undefined ? { key } : {}), kind: 'sheet', definition: sheet, ...extra }) as never
const create = (p: Payload, data: never) => p.create({ collection: 'label-media' as never, data })
const refusal = /already used/

describe('media key is unique across the collection', () => {
  let mongo: MongoMemoryReplSet
  let scoped: Payload
  let plain: Payload
  const t: Record<string, string | number> = {}
  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
    scoped = await make(mongo.getUri('scoped'), true)
    plain = await make(mongo.getUri('plain'), false)
    for (const n of ['a', 'b']) t[n] = (await scoped.create({ collection: 'tenants', data: { name: `Site ${n}` } })).id
  })
  afterAll(async () => {
    await scoped?.db.destroy?.()
    await plain?.db.destroy?.()
    await mongo?.stop()
  })

  it('refuses a duplicate key in the same scope on create', async () => {
    await create(scoped, media('dup', { tenant: t.a }))
    await expect(create(scoped, media('dup', { tenant: t.a }))).rejects.toThrow(refusal)
  })
  it('refuses the same key in a different site', async () => {
    await create(scoped, media('twin', { tenant: t.a }))
    await expect(create(scoped, media('twin', { tenant: t.b }))).rejects.toThrow(refusal)
  })
  it('refuses a site key that a shared record has, and the reverse', async () => {
    await create(scoped, media('shared-key'))
    await expect(create(scoped, media('shared-key', { tenant: t.a }))).rejects.toThrow(refusal)
    await create(scoped, media('site-key', { tenant: t.a }))
    await expect(create(scoped, media('site-key'))).rejects.toThrow(refusal)
  })
  it('refuses a key that is a preset name, on create and on update', async () => {
    for (const name of Object.keys(MEDIA_PRESETS)) await expect(create(scoped, media(name, { tenant: t.a }))).rejects.toThrow(/built-in preset/)
    const ok = await create(scoped, media('fine', { tenant: t.a }))
    await expect(scoped.update({ collection: 'label-media' as never, id: ok.id, data: { key: 'avery-5160' } as never })).rejects.toThrow(/built-in preset/)
  })
  it('refuses a change to a key another record in the scope already has, and allows keeping your own', async () => {
    await create(scoped, media('one', { tenant: t.a }))
    const two = await create(scoped, media('two', { tenant: t.a }))
    await expect(scoped.update({ collection: 'label-media' as never, id: two.id, data: { key: 'one' } as never })).rejects.toThrow(refusal)
    await expect(scoped.update({ collection: 'label-media' as never, id: two.id, data: { key: 'two', name: 'Renamed' } as never })).resolves.toBeTruthy()
    await expect(scoped.update({ collection: 'label-media' as never, id: two.id, data: { name: 'Again' } as never })).resolves.toBeTruthy()
  })
  it('refuses moving a record into a site only when the key clashes, never on a plain move', async () => {
    const mover = await create(scoped, media('mover', { tenant: t.a }))
    await expect(scoped.update({ collection: 'label-media' as never, id: mover.id, data: { tenant: t.b } as never })).resolves.toBeTruthy()
  })
  it('allows many records with no key', async () => {
    await create(scoped, media(undefined, { tenant: t.a }))
    await expect(create(scoped, media(undefined, { tenant: t.a }))).resolves.toBeTruthy()
  })
  it('without a scope field the key is unique everywhere', async () => {
    await create(plain, media('only'))
    await expect(create(plain, media('only'))).rejects.toThrow(refusal)
    await expect(create(plain, media('other'))).resolves.toBeTruthy()
  })
})
