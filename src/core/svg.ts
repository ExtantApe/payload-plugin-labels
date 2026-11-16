import { barcodePlacement, barcodeVector } from './vector.js'
import { pointsToMm } from './units.js'
import type { LayoutResult, Mark } from './types.js'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const n = (v: number) => String(Math.round(v * 1000) / 1000)
const ANCHOR = { left: 'start', center: 'middle', right: 'end' } as const
const FAMILY = 'Helvetica, Arial, sans-serif'

function markSvg(m: Mark): string {
  switch (m.type) {
    case 'text': {
      const size = pointsToMm(m.fontSize)
      const x = m.align === 'center' ? m.x + m.width / 2 : m.align === 'right' ? m.x + m.width : m.x
      const style = `font-family="${FAMILY}" font-size="${n(size)}"${m.bold ? ' font-weight="bold"' : ''}${m.italic ? ' font-style="italic"' : ''}${m.missing ? ' fill="#c2410c"' : ''}`
      return m.lines.map((l, i) => `<text x="${n(x)}" y="${n(m.y + size * (1 + i * 1.2))}" text-anchor="${ANCHOR[m.align]}" ${style}>${esc(l)}</text>`).join('')
    }
    case 'barcode': {
      const v = barcodeVector(m.symbology, m.value)
      if (!v) return `<rect x="${n(m.x)}" y="${n(m.y)}" width="${n(m.width)}" height="${n(m.height)}" fill="none" stroke="#c2410c" stroke-width="0.25" stroke-dasharray="1"/>`
      const p = barcodePlacement(m, v)
      const paths = v.paths.map((q) => (q.stroke ? `<path d="${q.d}" stroke="#000" stroke-width="${q.stroke}" fill="none"/>` : `<path d="${q.d}" fill="#000"/>`)).join('')
      const text = p.text ? `<text x="${n(p.text.x + p.text.width / 2)}" y="${n(p.text.y + pointsToMm(p.text.size))}" text-anchor="middle" font-family="${FAMILY}" font-size="${n(pointsToMm(p.text.size))}">${esc(m.value)}</text>` : ''
      return `<g transform="translate(${n(p.tx)} ${n(p.ty)}) scale(${n(p.sx)} ${n(p.sy)})">${paths}</g>${text}`
    }
    case 'image':
      return `<rect x="${n(m.x)}" y="${n(m.y)}" width="${n(m.width)}" height="${n(m.height)}" fill="#eee" stroke="#999" stroke-width="0.2"/>`
    case 'line':
      return `<line x1="${n(m.x)}" y1="${n(m.y)}" x2="${n(m.x + m.width)}" y2="${n(m.y + m.height)}" stroke="#000" stroke-width="${m.thickness}"/>`
    case 'box':
      return `<rect x="${n(m.x)}" y="${n(m.y)}" width="${n(m.width)}" height="${n(m.height)}" fill="none" stroke="#000" stroke-width="${m.thickness}"/>`
  }
}

/** The label as SVG in millimeters (viewBox 0 0 width height), for the preview. Draws the same marks as the PDF. */
export function renderSvg(result: LayoutResult): string {
  const body = result.marks
    .map((m) => {
      const s = markSvg(m)
      return m.rotation ? `<g transform="rotate(${m.rotation} ${n(m.x + m.width / 2)} ${n(m.y + m.height / 2)})">${s}</g>` : s
    })
    .join('\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(result.width)} ${n(result.height)}" width="${n(result.width)}mm" height="${n(result.height)}mm"><rect width="${n(result.width)}" height="${n(result.height)}" fill="#fff"/>\n${body}\n</svg>`
}
