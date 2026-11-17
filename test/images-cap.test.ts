import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { uploadLoader } from '../src/images.js'

// A made-up 1 x 1 pixel PNG, padded so each file is 100 bytes.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const dir = mkdtempSync(join(tmpdir(), 'labels-cap-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc(100 - b.length)])
writeFileSync(join(dir, 'a.png'), pad(PNG))
writeFileSync(join(dir, 'b.png'), pad(PNG))
// Not a real PNG: if this file were read, the loader would say so instead of naming the cap.
writeFileSync(join(dir, 'c.png'), Buffer.alloc(100))
writeFileSync(join(dir, 'd.png'), pad(PNG))

function fakePayload() {
  const looked: string[] = []
  let inFlight = 0
  let maxInFlight = 0
  const payload = {
    collections: { pics: { config: { upload: { staticDir: dir } } } },
    findByID: async ({ id }: { id: string }) => {
      looked.push(id)
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return { filename: `${id}.png`, mimeType: 'image/png' }
    },
  }
  return { payload, looked, maxInFlight: () => maxInFlight }
}

describe('the per-request image cap', () => {
  it('refuses a request over the cap before reading the files past it, even when asked for all at once', async () => {
    const f = fakePayload()
    const load = uploadLoader({ payload: f.payload as never, user: {}, uploads: ['pics'], maxTotalBytes: 250 })
    const got = await Promise.all(['a', 'b', 'c', 'd'].map((id) => load(id)))
    expect(typeof got[0]).toBe('object')
    expect(typeof got[1]).toBe('object')
    // c would take the total to 300 bytes: refused from its size alone, before its bytes are read
    expect(got[2]).toMatch(/add up to more/)
    // d is refused without even being looked up
    expect(got[3]).toMatch(/add up to more/)
    expect(f.looked).toEqual(['a', 'b', 'c'])
  })
  it('loads one picture at a time', async () => {
    const f = fakePayload()
    const load = uploadLoader({ payload: f.payload as never, user: {}, uploads: ['pics'] })
    await Promise.all(['a', 'b', 'd'].map((id) => load(id)))
    expect(f.maxInFlight()).toBe(1)
  })
  it('reads a picture used many times only once', async () => {
    const f = fakePayload()
    const load = uploadLoader({ payload: f.payload as never, user: {}, uploads: ['pics'], maxTotalBytes: 150 })
    const got = await Promise.all([load('a'), load('a'), load('a')])
    expect(got.every((g) => typeof g === 'object')).toBe(true)
    expect(f.looked).toEqual(['a'])
  })
})
