import { describe, expect, it } from 'vitest'

import { layout, renderSvg, THERMAL_4X6, type LabelTemplate } from '../src/core/index.js'
import { renderPdf } from '../src/pdf.js'

const kit = { code: 'KIT-0042', lot: 'L-77', name: 'Sample <kit> & more' }
const tpl: LabelTemplate = {
  key: 'kit-bag',
  size: { width: THERMAL_4X6.width, height: THERMAL_4X6.height },
  elements: [
    { type: 'text', x: 5, y: 5, width: 90, height: 12, fontSize: 18, bold: true, content: '{{name}}' },
    { type: 'barcode', x: 5, y: 25, width: 70, height: 25, symbology: 'code128', value: '{{code}}' },
    { type: 'qr', x: 5, y: 60, width: 30, height: 30, value: 'https://example.test/k/{{code}}' },
    { type: 'barcode', x: 40, y: 60, width: 30, height: 30, symbology: 'datamatrix', value: '{{lot}}' },
    { type: 'box', x: 2, y: 2, width: 97, height: 148 },
    { type: 'line', x: 5, y: 55, width: 90, height: 0 },
    { type: 'text', x: 5, y: 95, width: 40, height: 6, fontSize: 9, rotation: 90, content: 'Lot {{lot}}' },
  ],
}
const result = layout(tpl, kit, THERMAL_4X6)
const text = (b: Uint8Array) => Buffer.from(b).toString('latin1')

describe('PDF', () => {
  it('makes one page at 4 x 6 in (288 x 432 pt) per label', async () => {
    const one = text(await renderPdf([result]))
    expect(one.startsWith('%PDF-')).toBe(true)
    expect(one.match(/\/Type \/Page\b(?!s)/g)).toHaveLength(1)
    expect(one).toMatch(/\/MediaBox \[0 0 28[78]\.\d+ 43[12]\.\d+\]|\/MediaBox \[0 0 288 432\]/)
    expect(text(await renderPdf([result, result, result])).match(/\/Type \/Page\b(?!s)/g)).toHaveLength(3)
  })
  it('does not crash on an invalid barcode, and the layout warns', async () => {
    const bad = layout({ ...tpl, elements: [{ type: 'barcode', x: 0, y: 0, width: 40, height: 15, symbology: 'ean13', value: '{{code}}' }] }, kit)
    expect(bad.warnings[0]?.kind).toBe('invalid-barcode')
    expect((await renderPdf([bad])).length).toBeGreaterThan(100)
    expect(renderSvg(bad)).toContain('stroke-dasharray')
  })
})

describe('SVG', () => {
  const svg = renderSvg(result)
  it('uses the label size in millimeters as its viewBox, and escapes text', () => {
    expect(svg).toContain('viewBox="0 0 101.6 152.4"')
    expect(svg).toContain('Sample &lt;kit&gt; &amp; more')
    expect(svg).not.toContain('<kit>')
  })
  it('draws barcodes, a QR and a Data Matrix as vectors, with the value under the linear one', () => {
    expect(svg.match(/<g transform="translate/g)).toHaveLength(3)
    expect(svg).toContain('>KIT-0042</text>')
  })
  it('rotates a rotated mark and colors missing text', () => {
    expect(svg).toContain('rotate(90')
    expect(renderSvg(layout({ ...tpl, elements: [{ type: 'text', x: 0, y: 0, width: 30, height: 8, fontSize: 10, content: '{{nope}}' }] }, kit))).toContain('#c2410c')
  })
  it("both outputs draw one mark list: the same inputs give the same marks and SVG", () => {
    const again = layout(tpl, kit, THERMAL_4X6)
    expect(again.marks).toEqual(result.marks)
    expect(renderSvg(again)).toBe(svg)
  })
})

describe('SVG numbers', () => {
  it('writes only numbers into attributes, even for odd values that skipped validation', () => {
    const evil = { type: 'box', x: 1, y: 1, width: 10, height: 10, thickness: '0"/><img src=x onerror=alert(1)>', rotation: '0)"/><script>1</script>' } as never
    const svg = renderSvg(layout({ key: 'e', size: { width: 50, height: 50 }, elements: [evil] }, {}))
    expect(svg).not.toContain('<img')
    expect(svg).not.toContain('<script')
    expect(svg).not.toContain('onerror')
  })
})
