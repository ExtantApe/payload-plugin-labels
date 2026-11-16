/** All sizes and positions are millimeters. */
export type Rotation = 0 | 90 | 180 | 270
export type Overflow = 'shrink' | 'ellipsis' | 'wrap'
export type Symbology = 'code128' | 'code39' | 'ean13' | 'upca' | 'datamatrix'

export type LabelSize = { width: number; height: number }

type Box = { x: number; y: number; width: number; height: number; rotation?: Rotation }

export type TextElement = Box & {
  type: 'text'
  /** Text with `{{tokens}}`. */
  content: string
  font?: string
  /** Points. */
  fontSize: number
  bold?: boolean
  italic?: boolean
  align?: 'left' | 'center' | 'right'
  overflow?: Overflow
  /** For `wrap`. Default 2. */
  maxLines?: number
}
export type BarcodeElement = Box & { type: 'barcode'; symbology: Symbology; value: string; humanReadable?: boolean }
export type QrElement = Box & { type: 'qr'; value: string }
export type ImageElement = Box & { type: 'image'; /** An upload id, or a token naming an upload field. */ source: string }
export type LineElement = Box & { type: 'line'; thickness?: number }
export type BoxElement = Box & { type: 'box'; thickness?: number }
export type LabelElement = TextElement | BarcodeElement | QrElement | ImageElement | LineElement | BoxElement

export type LabelTemplate = {
  key: string
  size: LabelSize
  elements: LabelElement[]
}

export type ThermalMedia = {
  kind: 'thermal'
  key: string
  name: string
  width: number
  height: number
  /** Gap between labels on the roll. */
  gap: number
  dpi: 203 | 300 | 600
  offset: { x: number; y: number }
  /** Keep marks this far inside the label edge, or get a warning. Default 0. */
  safeMargin?: number
}
export type SheetMedia = {
  kind: 'sheet'
  key: string
  name: string
  page: { width: number; height: number }
  columns: number
  rows: number
  width: number
  height: number
  top: number
  left: number
  pitchX: number
  pitchY: number
  offset: { x: number; y: number }
  safeMargin?: number
}
export type LabelMedia = ThermalMedia | SheetMedia

export type Warning = {
  /** Index of the element in the template. */
  element: number
  kind: 'missing' | 'invalid-token' | 'overflow' | 'outside-safe-area' | 'invalid-barcode' | 'unreadable'
  message: string
}

export type Mark =
  | { type: 'text'; x: number; y: number; width: number; height: number; rotation: Rotation; lines: string[]; fontSize: number; font?: string; bold: boolean; italic: boolean; align: 'left' | 'center' | 'right'; missing: boolean }
  | { type: 'barcode'; x: number; y: number; width: number; height: number; rotation: Rotation; symbology: Symbology | 'qr'; value: string; humanReadable: boolean }
  | { type: 'image'; x: number; y: number; width: number; height: number; rotation: Rotation; source: string }
  | { type: 'line' | 'box'; x: number; y: number; width: number; height: number; rotation: Rotation; thickness: number }

export type LayoutResult = { width: number; height: number; marks: Mark[]; warnings: Warning[] }

/** Values the label context supplies: `label.number`, `label.of`, `printedAt`, `printedBy.name`, `site.name`. */
export type LabelContext = Record<string, unknown>
