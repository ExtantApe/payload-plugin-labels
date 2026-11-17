import { validBarcode } from './barcode.js'
import { fitText } from './fit.js'
import { resolveTokens } from './tokens.js'
import { round } from './units.js'
import type { LabelContext, LabelElement, LabelMedia, LabelTemplate, LayoutResult, Mark, Warning } from './types.js'

/**
 * One label: the template's elements with tokens resolved from `data`, as positioned marks in millimeters.
 * Every output (SVG preview, PDF, ZPL) draws this list. The media's calibration offset is applied here.
 */
export function layout(template: LabelTemplate, data: unknown, media?: LabelMedia, context: LabelContext = {}): LayoutResult {
  const warnings: Warning[] = []
  const marks: Mark[] = []
  const dx = media?.offset.x ?? 0
  const dy = media?.offset.y ?? 0
  const safe = media?.safeMargin ?? 0
  const { width: W, height: H } = template.size

  template.elements.forEach((el, i) => {
    const rotation = el.rotation ?? 0
    const base = { x: round(el.x + dx), y: round(el.y + dy), width: el.width, height: el.height, rotation }
    const warn = (kind: Warning['kind'], message: string) => warnings.push({ element: i, kind, message })
    // Content saved before validation existed may not be a string; treat it as empty.
    const tokens = (text: unknown) => {
      const r = resolveTokens(typeof text === 'string' ? text : '', data, context)
      for (const issue of r.issues) {
        warn(issue.kind, issue.kind === 'missing' ? `No value for {{${issue.token}}}` : `{{${issue.token}}} is not a valid token`)
      }
      return r
    }

    if (el.x < safe || el.y < safe || el.x + el.width > W - safe || el.y + el.height > H - safe) {
      warn('outside-safe-area', safe > 0 ? `Outside the ${safe} mm safe area` : 'Outside the label')
    }

    switch (el.type) {
      case 'text': {
        const r = tokens(el.content)
        const fit = fitText(r.text, el.width, el.height, el.fontSize, el.overflow ?? 'shrink', el.bold, el.maxLines ?? 2)
        if (fit.overflow) warn('overflow', 'Text does not fit its box')
        marks.push({ type: 'text', ...base, lines: fit.lines, fontSize: fit.fontSize, font: el.font, bold: !!el.bold, italic: !!el.italic, align: el.align ?? 'left', missing: r.issues.length > 0 })
        break
      }
      case 'barcode':
      case 'qr': {
        const value = tokens(el.type === 'qr' ? el.value : el.value).text
        const symbology = el.type === 'qr' ? 'qr' : el.symbology
        if (!validBarcode(symbology, value)) warn('invalid-barcode', `"${value}" is not valid for ${symbology}`)
        marks.push({ type: 'barcode', ...base, symbology, value, humanReadable: el.type === 'barcode' && el.humanReadable !== false })
        break
      }
      case 'image':
        marks.push({ type: 'image', ...base, source: tokens(el.source).text, element: i })
        break
      case 'line':
      case 'box':
        marks.push({ type: el.type, ...base, thickness: el.thickness ?? 0.25 })
        break
    }
  })
  return { width: W, height: H, marks, warnings }
}

/** Top-left corner of each label on a sheet, in order, starting at a 0-based `start` position. */
export function sheetPositions(media: Extract<LabelMedia, { kind: 'sheet' }>, count: number, start = 0): Array<{ page: number; x: number; y: number }> {
  const perPage = media.columns * media.rows
  return Array.from({ length: count }, (_, n) => {
    const slot = start + n
    const within = slot % perPage
    return {
      page: Math.floor(slot / perPage),
      x: round(media.left + (within % media.columns) * media.pitchX + media.offset.x),
      y: round(media.top + Math.floor(within / media.columns) * media.pitchY + media.offset.y),
    }
  })
}

export type { LabelElement }
