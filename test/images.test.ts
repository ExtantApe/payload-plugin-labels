import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { layout, renderSvg, resolveImages, type LabelTemplate } from '../src/core/index.js'
import { labelsPlugin, pruneLabelPrints } from '../src/index.js'
import { renderPdf } from '../src/pdf.js'

// A made-up 1 x 1 pixel PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const tpl = (source: string): LabelTemplate => ({ key: 't', size: { width: 60, height: 30 }, elements: [{ type: 'image', x: 2, y: 2, width: 20, height: 20, source } as never] })
const lay = (source: string) => layout(tpl(source), {}, undefined, {})
const ok = async () => ({ mime: 'image/png' as const, data: new Uint8Array(PNG) })

describe('image output', () => {
  it('draws the picture in SVG and PDF, and a placeholder without one', async () => {
    const r = await resolveImages(lay('x'), ok)
    expect(r.warnings).toEqual([])
    expect(renderSvg(r)).toContain('href="data:image/png;base64,iVBOR')
    expect(renderSvg(lay('x'))).not.toContain('<image')
    const pdf = Buffer.from(await renderPdf([r])).toString('latin1')
    expect(pdf).toContain('/Subtype /Image')
    expect(Buffer.from(await renderPdf([lay('x')])).toString('latin1')).not.toContain('/Subtype /Image')
  })
  it('keeps the placeholder and warns when the loader refuses, throws or the source is empty', async () => {
    const refused = await resolveImages(lay('x'), async () => 'Nope.')
    expect(refused.warnings).toEqual([{ element: 0, kind: 'image', message: 'Nope.' }])
    expect(refused.marks[0]).not.toHaveProperty('image')
    expect((await resolveImages(lay('x'), async () => { throw new Error('boom') })).warnings[0]!.kind).toBe('image')
    expect((await resolveImages(lay(''), ok)).warnings[0]!.message).toMatch(/No image/)
  })
})

let payload: Payload
let mongo: MongoMemoryReplSet
let dir: string
const ids: Record<string, string | number> = {}
const post = async (body: unknown) => {
  const ep = payload.config.endpoints.find((e) => e.path === '/labels/print')!
  return (await ep.handler({ payload, user: { collection: 'users', id: ids.user }, json: async () => body } as never)) as Response
}
const fakeUpload = (name: string, data: Buffer, mimetype: string) => payload.create({ collection: 'pics', data: {}, file: { data, mimetype, name, size: data.length } } as never)

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  dir = mkdtempSync(join(tmpdir(), 'labels-pics-'))
  payload = await getPayload({
    config: await buildConfig({
      secret: 'test-secret-not-for-production',
      telemetry: false,
      typescript: { autoGenerate: false },
      db: mongooseAdapter({ url: mongo.getUri('images'), ensureIndexes: true }),
      collections: [
        { slug: 'users', auth: true, fields: [] },
        { slug: 'orders', fields: [{ name: 'code', type: 'text' }] },
        { slug: 'pics', upload: { staticDir: dir }, fields: [], access: { read: ({ req }) => Boolean(req.user) } },
        { slug: 'secret-pics', upload: { staticDir: dir }, fields: [], access: { read: () => false } },
      ],
      plugins: [labelsPlugin({ access: { manage: ({ req }) => Boolean(req.user) }, uploads: ['pics', 'secret-pics'] })],
    }),
  })
  ids.user = (await payload.create({ collection: 'users', data: { email: 'p@example.test', password: 'test-pass-123' } as never })).id
  ids.order = (await payload.create({ collection: 'orders', data: { code: 'A1' } })).id
  ids.pic = (await fakeUpload('logo.png', PNG, 'image/png')).id
  const fake = (await fakeUpload('fake.png', PNG, 'image/png')) as unknown as { id: string | number; filename: string }
  writeFileSync(join(dir, fake.filename), 'not a png at all') // the file on disk is not what its record says
  ids.fake = fake.id
  // A real-looking PNG header that claims 20,000 x 20,000 pixels, and a file one byte over the size limit.
  const bomb = Buffer.alloc(33)
  PNG.subarray(0, 16).copy(bomb)
  bomb.writeUInt32BE(20000, 16)
  bomb.writeUInt32BE(20000, 20)
  const huge = (await fakeUpload('bomb.png', PNG, 'image/png')) as unknown as { id: string | number; filename: string }
  writeFileSync(join(dir, huge.filename), bomb)
  ids.bomb = huge.id
  const big = (await fakeUpload('big.png', PNG, 'image/png')) as unknown as { id: string | number; filename: string }
  writeFileSync(join(dir, big.filename), Buffer.concat([PNG.subarray(0, 24), Buffer.alloc(5 * 1024 * 1024)]))
  ids.big = big.id
  for (const [key, source] of [['with-pic', `pics:${ids.pic}`], ['remote', 'https://example.test/x.png'], ['fake', `pics:${ids.fake}`], ['hidden', 'secret-pics:1'], ['other', 'users:1'], ['bomb', `pics:${ids.bomb}`], ['big', `pics:${ids.big}`]] as const)
    await payload.create({ collection: 'label-templates' as never, data: { name: key, key, collection: 'orders', width: 60, height: 30, elements: tpl(source).elements } as never })
})
afterAll(async () => {
  await payload?.db.destroy?.()
  await mongo?.stop()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('images on the print endpoint', () => {
  it('prints an allowed upload the person can read into the PDF', async () => {
    const r = await post({ template: 'with-pic', ids: [ids.order] })
    expect(r.status).toBe(200)
    const txt = Buffer.from(await r.arrayBuffer()).toString('latin1')
    expect(txt).toContain('/Subtype /Image')
  })
  it('never fetches a web address, and refuses other collections, unreadable uploads and non-images with a placeholder', async () => {
    for (const key of ['remote', 'fake', 'hidden', 'other', 'bomb', 'big']) {
      const r = await post({ template: key, ids: [ids.order] })
      expect(r.status).toBe(200)
      expect(Buffer.from(await r.arrayBuffer()).toString('latin1'), key).not.toContain('/Subtype /Image')
    }
  })
})

describe('images in a big run', () => {
  it('embeds one copy per picture: the PDF barely grows with the label count', async () => {
    const size = async (n: number) => (await post({ template: 'with-pic', ids: [ids.order], copies: n }).then((r) => r.arrayBuffer())).byteLength
    const one = await size(1)
    const many = await size(200)
    // 200 pages of marks add page overhead, but not 200 copies of the picture
    expect(many).toBeLessThan(one + 200 * 700)
    const images = async (n: number) => Buffer.from(new Uint8Array(await (await post({ template: 'with-pic', ids: [ids.order], copies: n })).arrayBuffer())).toString('latin1').match(/\/Subtype \/Image/g)?.length
    // the same number of image objects (the picture and its transparency mask) for 1 label or 50
    expect(await images(50)).toBe(await images(1))
  })
})

describe('pruneLabelPrints', () => {
  const day = 86_400_000
  const make = (daysOld: number) => payload.create({ collection: 'label-prints' as never, data: { collection: 'orders', labelCount: 1, createdAt: new Date(Date.now() - daysOld * day).toISOString() } as never, overrideAccess: true })
  const count = async () => (await payload.count({ collection: 'label-prints' as never })).totalDocs
  it('deletes entries older than keepDays, keeps recent ones, and keeps all when keepDays is 0', async () => {
    const start = await count()
    await make(400)
    await make(200)
    await make(10)
    expect(await pruneLabelPrints(payload, { keepDays: 0 })).toBe(0)
    expect(await count()).toBe(start + 3)
    expect(await pruneLabelPrints(payload, { keepDays: 365 })).toBe(1)
    expect(await pruneLabelPrints(payload)).toBe(1) // the plugin default is 180 days
    expect(await count()).toBe(start + 1)
  })
  it('keeps everything for a setting that is not a whole number of days', async () => {
    const start = await count()
    await make(400)
    for (const keepDays of [0.001, -5, NaN, Infinity, 1.5, '30']) expect(await pruneLabelPrints(payload, { keepDays: keepDays as number })).toBe(0)
    expect(await count()).toBe(start + 1)
  })
})
