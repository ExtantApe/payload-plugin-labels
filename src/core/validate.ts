import type { LabelElement } from './types.js'

const TYPES = ['text', 'barcode', 'qr', 'image', 'line', 'box'] as const
const SYMBOLOGIES = ['code128', 'code39', 'ean13', 'upca', 'datamatrix']
const ALIGN = ['left', 'center', 'right']
const OVERFLOW = ['shrink', 'ellipsis', 'wrap']
const MAX_ELEMENTS = 200
const MAX_TEXT = 2000
const MAX_MM = 2000

const num = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const str = (v: unknown) => typeof v === 'string' && v.length <= MAX_TEXT

/**
 * Checks a template's `elements` before they are stored: known kinds, finite numbers in range, strings where strings
 * belong, enums from a fixed list. Returns a plain message for the first problem, or undefined when it is fine.
 */
export function validateElements(value: unknown): string | undefined {
  if (!Array.isArray(value)) return 'Elements must be a list.'
  if (value.length > MAX_ELEMENTS) return `A template holds at most ${MAX_ELEMENTS} elements.`
  for (const [i, raw] of value.entries()) {
    const at = `Element ${i + 1}`
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return `${at} must be an object.`
    const el = raw as Record<string, unknown>
    if (!TYPES.includes(el.type as never)) return `${at} has an unknown type.`
    if (!num(el.x, -MAX_MM, MAX_MM) || !num(el.y, -MAX_MM, MAX_MM)) return `${at} needs x and y as numbers in millimeters.`
    if (!num(el.width, 0, MAX_MM) || !num(el.height, 0, MAX_MM)) return `${at} needs width and height as numbers in millimeters.`
    if (el.rotation !== undefined && ![0, 90, 180, 270].includes(el.rotation as number)) return `${at} rotation must be 0, 90, 180 or 270.`
    switch (el.type as LabelElement['type']) {
      case 'text':
        if (!str(el.content)) return `${at} needs text content.`
        if (!num(el.fontSize, 1, 500)) return `${at} needs a font size from 1 to 500 points.`
        if (el.font !== undefined && !str(el.font)) return `${at} font must be text.`
        if (el.align !== undefined && !ALIGN.includes(el.align as string)) return `${at} has an unknown alignment.`
        if (el.overflow !== undefined && !OVERFLOW.includes(el.overflow as string)) return `${at} has an unknown overflow rule.`
        if (el.maxLines !== undefined && !(num(el.maxLines, 1, 20) && Number.isInteger(el.maxLines))) return `${at} max lines must be a whole number from 1 to 20.`
        for (const k of ['bold', 'italic']) if (el[k] !== undefined && typeof el[k] !== 'boolean') return `${at} ${k} must be true or false.`
        break
      case 'barcode':
        if (!SYMBOLOGIES.includes(el.symbology as string)) return `${at} has an unknown barcode type.`
        if (!str(el.value)) return `${at} needs a value.`
        if (el.humanReadable !== undefined && typeof el.humanReadable !== 'boolean') return `${at} humanReadable must be true or false.`
        break
      case 'qr':
        if (!str(el.value)) return `${at} needs a value.`
        break
      case 'image':
        if (!str(el.source)) return `${at} needs an image source.`
        break
      case 'line':
      case 'box':
        if (el.thickness !== undefined && !num(el.thickness, 0, 50)) return `${at} thickness must be a number from 0 to 50 millimeters.`
        break
    }
  }
  return undefined
}
