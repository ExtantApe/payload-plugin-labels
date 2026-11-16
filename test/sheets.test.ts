import { describe, expect, it } from 'vitest'

import { AVERY_5160, AVERY_5163, layout, MEDIA_PRESETS, parseMedia, sheetPositions, type LabelTemplate } from '../src/core/index.js'
import { renderPdf } from '../src/pdf.js'

const tpl: LabelTemplate = { key: 't', size: { width: 60, height: 20 }, elements: [{ type: 'text', x: 1, y: 1, width: 50, height: 8, fontSize: 10, content: 'Item' } as never] }
const one = () => layout(tpl, {}, undefined, {})
const text = (b: Uint8Array) => Buffer.from(b).toString('latin1')
const pageCount = (b: Uint8Array) => text(b).match(/\/Type \/Page\b(?!s)/g)?.length ?? 0
const sizes = (b: Uint8Array) => [...text(b).matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => [Math.round(Number(m[1])), Math.round(Number(m[2]))])

describe('sheet math', () => {
  it('presets are Letter grids that fit the page', () => {
    for (const m of [AVERY_5160, AVERY_5163]) {
      expect(m.page).toEqual({ width: 215.9, height: 279.4 })
      const last = sheetPositions(m, m.columns * m.rows)[m.columns * m.rows - 1]!
      expect(last.x + m.width).toBeLessThanOrEqual(m.page.width)
      expect(last.y + m.height).toBeLessThanOrEqual(m.page.height)
    }
    expect(AVERY_5160.columns * AVERY_5160.rows).toBe(30)
    expect(Object.keys(MEDIA_PRESETS)).toContain('avery-5163')
  })
  it('places slots by row then column, from the start slot, and flows onto a second page', () => {
    const p = sheetPositions(AVERY_5160, 4, 28)
    expect(p.map((s) => s.page)).toEqual([0, 0, 1, 1])
    expect(p[0]).toMatchObject({ x: 75.432, y: 241.3 }) // slot 29: second column, last row
    expect(p[2]).toMatchObject({ x: 5.582, y: 12.7 }) // slot 31: first slot of page 2
  })
  it('the calibration offset moves every slot once', () => {
    const a = sheetPositions({ ...AVERY_5163, offset: { x: 1, y: -2 } }, 1)[0]!
    const b = sheetPositions(AVERY_5163, 1)[0]!
    expect([a.x - b.x, a.y - b.y].map((n) => Math.round(n * 100) / 100)).toEqual([1, -2])
  })
})

describe('renderPdf on sheets', () => {
  it('makes Letter pages (612 x 792 pt) and counts pages from the start slot', async () => {
    const thirty = Array.from({ length: 30 }, one)
    expect(pageCount(await renderPdf(thirty, AVERY_5160))).toBe(1)
    const shifted = await renderPdf(thirty, AVERY_5160, 1)
    expect(pageCount(shifted)).toBe(2)
    expect(sizes(shifted)).toEqual([[612, 792], [612, 792]])
    expect(pageCount(await renderPdf([one()], AVERY_5160, 29))).toBe(1)
    expect(pageCount(await renderPdf(Array.from({ length: 2 }, one), AVERY_5160, 29))).toBe(2)
  })
  it('thermal still makes one page per label at the label size', async () => {
    expect(sizes(await renderPdf([one(), one()]))).toEqual([[170, 57], [170, 57]])
  })
})

describe('parseMedia', () => {
  const good = { page: { width: 215.9, height: 279.4 }, columns: 2, rows: 2, width: 90, height: 50, top: 10, left: 10, pitchX: 100, pitchY: 60 }
  it('accepts a good sheet and refuses bad ones with a message', () => {
    expect(parseMedia('sheet', 'k', 'n', good)).toMatchObject({ kind: 'sheet', columns: 2 })
    for (const bad of [{ ...good, columns: 0 }, { ...good, columns: 1.5 }, { ...good, pitchX: -1 }, { ...good, columns: 5 }, { ...good, page: {} }, undefined]) expect(typeof parseMedia('sheet', 'k', 'n', bad)).toBe('string')
    expect(typeof parseMedia('thermal', 'k', 'n', { width: 0, height: 5 })).toBe('string')
    expect(typeof parseMedia('roll', 'k', 'n', good)).toBe('string')
  })
})

describe('print button wiring', () => {
  it('adds the admin components only to collections named in `collections`', async () => {
    const { labelsPlugin } = await import('../src/index.js')
    const cfg = await labelsPlugin({ access: { manage: () => true }, collections: ['orders'] })({ collections: [{ slug: 'orders', fields: [] }, { slug: 'kits', fields: [] }] } as never)
    const by = (s: string) => cfg.collections!.find((c) => c.slug === s)!
    expect(by('orders').admin?.components?.beforeListTable).toEqual(['@extantape/payload-plugin-labels/client#ListViewPrintButton'])
    expect(by('orders').admin?.components?.edit?.beforeDocumentControls).toEqual(['@extantape/payload-plugin-labels/client#EditViewPrintButton'])
    expect(by('kits').admin?.components).toBeUndefined()
  })
})
