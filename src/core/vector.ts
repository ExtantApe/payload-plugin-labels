import bwip from 'bwip-js'

import { pointsToMm } from './units.js'
import type { Mark } from './types.js'

/** One drawn path in the barcode's own units: a stroked line set (bars) or a filled shape (QR, Data Matrix). */
export type VectorPath = { d: string; stroke?: number }
export type BarcodeVector = { width: number; height: number; paths: VectorPath[] }
type BarcodeMark = Extract<Mark, { type: 'barcode' }>

const BCID: Record<BarcodeMark['symbology'], string> = { code128: 'code128', code39: 'code39', ean13: 'ean13', upca: 'upca', datamatrix: 'datamatrix', qr: 'qrcode' }

/** Vector drawing of a barcode (bwip-js). Returns null if the value can't be encoded; the caller draws an empty box. */
export function barcodeVector(symbology: BarcodeMark['symbology'], value: string): BarcodeVector | null {
  try {
    const svg = bwip.toSVG({ bcid: BCID[symbology], text: value, scale: 1, includetext: false })
    const vb = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg)
    if (!vb) return null
    const paths = [...svg.matchAll(/<path ([^>]*?)\/>/g)].map((m): VectorPath => {
      const attrs = m[1]!
      const stroke = /stroke-width="([\d.]+)"/.exec(attrs)
      return { d: /\sd="([^"]*)"/.exec(` ${attrs}`)?.[1] ?? '', ...(stroke ? { stroke: Number(stroke[1]) } : {}) }
    })
    return paths.length ? { width: Number(vb[1]), height: Number(vb[2]), paths } : null
  } catch {
    return null
  }
}

/** Where a barcode sits inside its mark: a transform for the vector, and the text line under 1D codes. Millimeters. */
export function barcodePlacement(m: BarcodeMark, v: BarcodeVector) {
  const twoD = m.symbology === 'qr' || m.symbology === 'datamatrix'
  const textSize = 7
  const textH = !twoD && m.humanReadable ? pointsToMm(textSize) * 1.3 : 0
  const h = Math.max(m.height - textH, 0.1)
  const sx = twoD ? Math.min(m.width / v.width, h / v.height) : m.width / v.width
  const sy = twoD ? sx : h / v.height
  const tx = m.x + (twoD ? (m.width - v.width * sx) / 2 : 0)
  const ty = m.y + (twoD ? (h - v.height * sy) / 2 : 0)
  return { sx, sy, tx, ty, text: textH > 0 ? { x: m.x, y: m.y + h, width: m.width, size: textSize } : null }
}
