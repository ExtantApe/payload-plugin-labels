import { describe, expect, it } from 'vitest'

import { fitText, inchesToMm, layout, resolveTokens, sheetPositions, THERMAL_4X6, validBarcode, type LabelTemplate, type SheetMedia } from '../src/core/index.js'

const order = { code: 'ORD-1042', total: 1234.5, notes: '', createdAt: '2026-03-07T10:00:00Z', customer: { name: 'Sam Example', email: 'sam@example.test' } }

describe('units and preset', () => {
  it('4x6 inch thermal is 101.6 x 152.4 mm at 203 dpi', () => {
    expect([THERMAL_4X6.width, THERMAL_4X6.height, THERMAL_4X6.dpi]).toEqual([101.6, 152.4, 203])
    expect(inchesToMm(2.25)).toBe(57.15)
  })
})

describe('tokens', () => {
  it('resolves dotted paths and context', () => {
    const r = resolveTokens('{{code}} {{customer.name}} {{label.number}} of {{label.of}}', order, { label: { number: 3, of: 12 } })
    expect(r).toEqual({ text: 'ORD-1042 Sam Example 3 of 12', issues: [] })
  })
  it('applies formatters', () => {
    expect(resolveTokens('{{createdAt | date:"MMM D, YYYY"}}|{{total | money}}|{{code | lower}}|{{code | slice:0:3}}|{{notes | default:"-"}}', order).text).toBe('Mar 7, 2026|1,234.50|ord-1042|ORD|-')
  })
  it('reports missing tokens and prints them empty', () => {
    const r = resolveTokens('a{{nope}}b', order)
    expect(r.text).toBe('ab')
    expect(r.issues).toEqual([{ token: 'nope', kind: 'missing' }])
  })
  it('refuses anything that looks like code', () => {
    for (const body of ['constructor.constructor("x")()', 'code | eval', 'a.b.c.d.e', 'code | slice:foo']) {
      expect(resolveTokens(`{{${body}}}`, order).issues[0]?.kind).toBe('invalid-token')
    }
  })
  it('does not read inherited properties', () => {
    expect(resolveTokens('{{toString}}{{__proto__.x}}', order)).toEqual({ text: '', issues: [{ token: 'toString', kind: 'missing' }, { token: '__proto__.x', kind: 'missing' }] })
  })
})

describe('fitting', () => {
  it('shrinks to fit, down to a floor', () => {
    expect(fitText('Short', 50, 10, 12, 'shrink').fontSize).toBe(12)
    const f = fitText('A very long product name that cannot fit', 30, 10, 12, 'shrink')
    expect(f.fontSize).toBeLessThan(12)
    expect(fitText('x'.repeat(400), 30, 10, 12, 'shrink')).toMatchObject({ fontSize: 4, overflow: true })
  })
  it('cuts with an ellipsis', () => {
    const f = fitText('A very long product name that cannot fit', 30, 10, 12, 'ellipsis')
    expect(f.lines[0]!.endsWith('…')).toBe(true)
  })
  it('wraps to a maximum number of lines', () => {
    const f = fitText('one two three four five six seven eight nine ten', 30, 30, 12, 'wrap', false, 2)
    expect(f.lines).toHaveLength(2)
    expect(f.overflow).toBe(true)
  })
})

describe('layout', () => {
  const tpl: LabelTemplate = {
    key: 'order-box',
    size: { width: THERMAL_4X6.width, height: THERMAL_4X6.height },
    elements: [
      { type: 'text', x: 5, y: 5, width: 90, height: 12, fontSize: 18, content: '{{customer.name}}' },
      { type: 'barcode', x: 5, y: 20, width: 60, height: 20, symbology: 'code128', value: '{{code}}' },
      { type: 'text', x: 5, y: 45, width: 90, height: 8, fontSize: 10, content: '{{missing.thing}}' },
      { type: 'box', x: 120, y: 0, width: 10, height: 10 },
    ],
  }
  const result = layout(tpl, order, { ...THERMAL_4X6, offset: { x: 1, y: -0.5 } })
  it('returns marks in mm with the calibration offset applied', () => {
    expect(result.width).toBe(101.6)
    expect(result.marks).toHaveLength(4)
    expect(result.marks[0]).toMatchObject({ type: 'text', x: 6, y: 4.5, lines: ['Sam Example'] })
    expect(result.marks[1]).toMatchObject({ type: 'barcode', value: 'ORD-1042', humanReadable: true })
  })
  it('warns about missing values and marks outside the label', () => {
    expect(result.warnings.map((w) => [w.element, w.kind])).toEqual([[2, 'missing'], [3, 'outside-safe-area']])
    expect(result.marks[2]).toMatchObject({ type: 'text', missing: true })
  })
  it('warns about a barcode value the symbology cannot hold', () => {
    const r = layout({ ...tpl, elements: [{ type: 'barcode', x: 0, y: 0, width: 10, height: 10, symbology: 'ean13', value: '{{code}}' }] }, order)
    expect(r.warnings[0]?.kind).toBe('invalid-barcode')
  })
  it('validates barcode values', () => {
    expect(validBarcode('ean13', '4006381333931')).toBe(true)
    expect(validBarcode('code39', 'abc')).toBe(false)
    expect(validBarcode('code128', '')).toBe(false)
  })
})

describe('sheet positions', () => {
  const sheet: SheetMedia = { kind: 'sheet', key: 't', name: 't', page: { width: 215.9, height: 279.4 }, columns: 3, rows: 10, width: 66.675, height: 25.4, top: 12.7, left: 4.762, pitchX: 69.85, pitchY: 25.4, offset: { x: 0, y: 0 } }
  it('starts at a chosen slot and rolls onto the next page', () => {
    const p = sheetPositions(sheet, 3, 29)
    expect(p[0]).toEqual({ page: 0, x: 144.462, y: 241.3 })
    expect(p[1]).toEqual({ page: 1, x: 4.762, y: 12.7 })
    expect(p[2]?.x).toBe(74.612)
  })
})

describe('validateElements', () => {
  it('names the first problem and accepts good elements', async () => {
    const { validateElements } = await import('../src/core/validate.js')
    expect(validateElements([{ type: 'line', x: 0, y: 0, width: 10, height: 0, thickness: 0.5 }])).toBeUndefined()
    expect(validateElements([{ type: 'line', x: 0, y: 0, width: 10, height: 0, thickness: NaN }])).toContain('thickness')
    expect(validateElements([{ type: 'qr', x: 0, y: 0, width: 10, height: 10 }])).toContain('value')
    expect(validateElements(Array.from({ length: 201 }, () => ({ type: 'box', x: 0, y: 0, width: 1, height: 1 })))).toContain('at most')
  })
})
