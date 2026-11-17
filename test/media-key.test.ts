import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { labelsPlugin } from '../src/index.js'

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

describe('media key is unique per scope', () => {
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
  it('allows the same key in a different scope', async () => {
    await create(scoped, media('twin', { tenant: t.a }))
    await expect(create(scoped, media('twin', { tenant: t.b }))).resolves.toBeTruthy()
  })
  it('treats records with no scope as one scope of their own', async () => {
    await create(scoped, media('shared-key'))
    await expect(create(scoped, media('shared-key'))).rejects.toThrow(refusal)
    await expect(create(scoped, media('shared-key', { tenant: t.a }))).resolves.toBeTruthy()
  })
  it('refuses a change to a key another record in the scope already has, and allows keeping your own', async () => {
    await create(scoped, media('one', { tenant: t.a }))
    const two = await create(scoped, media('two', { tenant: t.a }))
    await expect(scoped.update({ collection: 'label-media' as never, id: two.id, data: { key: 'one' } as never })).rejects.toThrow(refusal)
    await expect(scoped.update({ collection: 'label-media' as never, id: two.id, data: { key: 'two', name: 'Renamed' } as never })).resolves.toBeTruthy()
    await expect(scoped.update({ collection: 'label-media' as never, id: two.id, data: { name: 'Again' } as never })).resolves.toBeTruthy()
  })
  it('refuses moving a record into a scope that already has its key', async () => {
    await create(scoped, media('moving', { tenant: t.a }))
    const other = await create(scoped, media('moving', { tenant: t.b }))
    await expect(scoped.update({ collection: 'label-media' as never, id: other.id, data: { tenant: t.a } as never })).rejects.toThrow(refusal)
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
