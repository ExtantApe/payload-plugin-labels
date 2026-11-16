import { pointsToMm } from './units.js'
import type { Overflow } from './types.js'

/** No font files here, so width is estimated: an average glyph is about 0.52 em wide (0.58 bold). */
export function textWidthMm(text: string, fontSize: number, bold = false): number {
  return text.length * fontSize * (bold ? 0.58 : 0.52) * (25.4 / 72)
}
const LINE_HEIGHT = 1.2
export const MIN_FONT_SIZE = 4

export type Fit = { lines: string[]; fontSize: number; overflow: boolean }

function wrap(text: string, max: number, size: number, bold: boolean): string[] {
  const lines: string[] = []
  let cur = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word
    if (cur && textWidthMm(next, size, bold) > max) {
      lines.push(cur)
      cur = word
    } else cur = next
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

function ellipsize(text: string, max: number, size: number, bold: boolean): string {
  if (textWidthMm(text, size, bold) <= max) return text
  let s = text
  while (s.length > 0 && textWidthMm(`${s}…`, size, bold) > max) s = s.slice(0, -1)
  return `${s.trimEnd()}…`
}

/** Fit text into a box with the element's overflow rule. `overflow: true` means it still doesn't fit. */
export function fitText(text: string, width: number, height: number, size: number, rule: Overflow, bold = false, maxLines = 2): Fit {
  const fitsHeight = (n: number, s: number) => n * pointsToMm(s) * LINE_HEIGHT <= height + 1e-9
  if (rule === 'shrink') {
    let s = size
    while (s > MIN_FONT_SIZE && (textWidthMm(text, s, bold) > width || !fitsHeight(1, s))) s -= 0.5
    return { lines: [text], fontSize: s, overflow: textWidthMm(text, s, bold) > width || !fitsHeight(1, s) }
  }
  if (rule === 'ellipsis') {
    const line = ellipsize(text, width, size, bold)
    return { lines: [line], fontSize: size, overflow: !fitsHeight(1, size) }
  }
  let lines = wrap(text, width, size, bold)
  let overflow = lines.some((l) => textWidthMm(l, size, bold) > width)
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines)
    lines[maxLines - 1] = ellipsize(`${lines[maxLines - 1]} …`, width, size, bold)
    overflow = true
  }
  return { lines, fontSize: size, overflow: overflow || !fitsHeight(lines.length, size) }
}
