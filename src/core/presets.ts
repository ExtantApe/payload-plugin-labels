import { inchesToMm } from './units.js'
import type { LabelMedia, SheetMedia, ThermalMedia } from './types.js'

/** 4 x 6 inch thermal roll, 203 dpi. The 3 mm gap is a typical roll value; calibrate per printer. */
export const THERMAL_4X6: ThermalMedia = {
  kind: 'thermal',
  key: 'thermal-4x6',
  name: '4 x 6 in thermal',
  width: inchesToMm(4),
  height: inchesToMm(6),
  gap: 3,
  dpi: 203,
  offset: { x: 0, y: 0 },
}

const LETTER = { width: inchesToMm(8.5), height: inchesToMm(11) }

/** Avery 5160 address labels, US Letter, 3 x 10. Published sizes: 2 5/8 x 1 in, 0.5 in top margin, 0.21975 in side margin, 2.75 in across, 1 in down. */
export const AVERY_5160: SheetMedia = {
  kind: 'sheet', key: 'avery-5160', name: 'Avery 5160, 30 per sheet (2 5/8 x 1 in)', page: LETTER,
  columns: 3, rows: 10, width: inchesToMm(2.625), height: inchesToMm(1), top: inchesToMm(0.5), left: inchesToMm(0.21975),
  pitchX: inchesToMm(2.75), pitchY: inchesToMm(1), offset: { x: 0, y: 0 },
}

/** Avery 5163 shipping labels, US Letter, 2 x 5. Published sizes: 4 x 2 in, 0.5 in top margin, 0.15625 in side margin, 4.1875 in across, 2 in down. */
export const AVERY_5163: SheetMedia = {
  kind: 'sheet', key: 'avery-5163', name: 'Avery 5163, 10 per sheet (4 x 2 in)', page: LETTER,
  columns: 2, rows: 5, width: inchesToMm(4), height: inchesToMm(2), top: inchesToMm(0.5), left: inchesToMm(0.15625),
  pitchX: inchesToMm(4.1875), pitchY: inchesToMm(2), offset: { x: 0, y: 0 },
}

export const MEDIA_PRESETS: Record<string, LabelMedia> = { [THERMAL_4X6.key]: THERMAL_4X6, [AVERY_5160.key]: AVERY_5160, [AVERY_5163.key]: AVERY_5163 }

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const pos = (v: unknown): v is number => num(v) && v > 0
const off = (v: unknown): { x: number; y: number } => {
  const o = (v ?? {}) as { x?: unknown; y?: unknown }
  return { x: num(o.x) ? o.x : 0, y: num(o.y) ? o.y : 0 }
}

/** Turn a stored media record into a media, or say what is wrong. Sizes are millimeters. */
/** Upper bounds on stored media, so a record cannot ask for a huge page or millions of slots. */
export const MAX_MEDIA_MM = 1000
export const MAX_SHEET_SLOTS = 1000

export function parseMedia(kind: unknown, key: string, name: string, def: unknown): LabelMedia | string {
  const d = (def ?? {}) as Record<string, unknown>
  if (kind === 'thermal') {
    if (!pos(d.width) || !pos(d.height)) return 'That media needs a width and height above zero.'
    if (d.width > MAX_MEDIA_MM || d.height > MAX_MEDIA_MM) return `That media is larger than ${MAX_MEDIA_MM} mm on a side.`
    const dpi = d.dpi === 300 || d.dpi === 600 ? d.dpi : 203
    return { kind: 'thermal', key, name, width: d.width, height: d.height, gap: num(d.gap) && d.gap >= 0 ? d.gap : 3, dpi, offset: off(d.offset) }
  }
  if (kind === 'sheet') {
    const pg = (d.page ?? {}) as { width?: unknown; height?: unknown }
    if (!pos(pg.width) || !pos(pg.height)) return 'That sheet needs a page width and height above zero.'
    if (pg.width > MAX_MEDIA_MM || pg.height > MAX_MEDIA_MM) return `That sheet's page is larger than ${MAX_MEDIA_MM} mm on a side.`
    if (Number.isInteger(d.columns) && Number.isInteger(d.rows) && (d.columns as number) * (d.rows as number) > MAX_SHEET_SLOTS) return `That sheet has more than ${MAX_SHEET_SLOTS} labels per page.`
    const ints = Number.isInteger(d.columns) && Number.isInteger(d.rows) && (d.columns as number) > 0 && (d.rows as number) > 0
    if (!ints || !pos(d.width) || !pos(d.height) || !pos(d.pitchX) || !pos(d.pitchY) || !num(d.top) || !num(d.left) || d.top < 0 || d.left < 0) return 'That sheet needs whole columns and rows, a label size, pitches above zero and margins.'
    const m: SheetMedia = { kind: 'sheet', key, name, page: { width: pg.width, height: pg.height }, columns: d.columns as number, rows: d.rows as number, width: d.width, height: d.height, top: d.top, left: d.left, pitchX: d.pitchX, pitchY: d.pitchY, offset: off(d.offset) }
    const right = m.left + (m.columns - 1) * m.pitchX + m.width
    const bottom = m.top + (m.rows - 1) * m.pitchY + m.height
    if (right > m.page.width + 0.01 || bottom > m.page.height + 0.01) return 'That sheet layout runs off the page.'
    return m
  }
  return 'That media has no kind.'
}
