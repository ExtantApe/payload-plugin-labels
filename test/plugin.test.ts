import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { buildConfig } from 'payload'
import { describe, expect, it } from 'vitest'

import { labelsPlugin, type LabelsOptions } from '../src/index.js'

const build = (options?: LabelsOptions, extra: object = {}) =>
  buildConfig({
    secret: 'test-secret-not-for-production',
    telemetry: false,
    typescript: { autoGenerate: false },
    db: mongooseAdapter({ url: 'mongodb://127.0.0.1:1/unused' }),
    collections: [{ slug: 'users', auth: true, fields: [] }, { slug: 'tenants', fields: [{ name: 'name', type: 'text' }] }],
    plugins: [labelsPlugin(options)],
    ...extra,
  })
const slugs = (c: Awaited<ReturnType<typeof build>>) => c.collections.map((x) => x.slug)
const call = (fn: unknown, user?: object) => (fn as (a: object) => unknown)({ req: { user } })

describe('labelsPlugin', () => {
  it('adds the three collections', async () => {
    expect(slugs(await build())).toEqual(expect.arrayContaining(['label-templates', 'label-media', 'label-prints']))
  })
  it('refuses every write by default, and reads for signed-out people', async () => {
    const c = await build()
    for (const slug of ['label-templates', 'label-media', 'label-prints']) {
      const a = c.collections.find((x) => x.slug === slug)!.access
      for (const op of ['create', 'update', 'delete'] as const) expect(await call(a[op], { id: '1' })).toBe(false)
    }
    expect(await call(c.collections.find((x) => x.slug === 'label-templates')!.access.read)).toBe(false)
    expect(await call(c.collections.find((x) => x.slug === 'label-prints')!.access.read, { id: '1' })).toBe(false)
  })
  it('lets the site grant writes, but only on exactly true; the log stays unwritable', async () => {
    const c = await build({ access: { manage: ({ req }) => (req.user as { admin?: boolean } | undefined)?.admin === true, print: (() => 1) as never } })
    const t = c.collections.find((x) => x.slug === 'label-templates')!.access
    expect(await call(t.create, { admin: true })).toBe(true)
    expect(await call(t.create, { admin: false })).toBe(false)
    expect(await call(t.read, { admin: true })).toBe(true)
    expect(await call(c.collections.find((x) => x.slug === 'label-prints')!.access.create, { admin: true })).toBe(false)
  })
  it('a throwing check is a no', async () => {
    const c = await build({ access: { manage: () => { throw new Error('boom') } } })
    expect(await call(c.collections.find((x) => x.slug === 'label-templates')!.access.update, { id: '1' })).toBe(false)
  })
  it('adds the scope field, and refuses a scope field without a collection', async () => {
    const c = await build({ scopeField: 'tenant', scopeCollection: 'tenants', scopeOf: () => null })
    const f = c.collections.find((x) => x.slug === 'label-templates')!.fields.map((x) => ('name' in x ? x.name : ''))
    expect(f).toContain('tenant')
    await expect(build({ scopeField: 'tenant', scopeCollection: 'tenants' })).rejects.toThrow(/scopeOf/)
  })
  it('can switch the log off, and keeps providers other plugins added', async () => {
    const c = await build({ log: { enabled: false } }, { custom: { labels: { providers: { kitting: { name: 'Kitting' } } } } })
    expect(slugs(c)).not.toContain('label-prints')
    expect((c.custom as { labels: { providers: object } }).labels.providers).toHaveProperty('kitting')
  })
})
