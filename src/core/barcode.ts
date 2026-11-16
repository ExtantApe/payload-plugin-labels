import type { Symbology } from './types.js'

/** Value checks per symbology. Drawing is not here yet. */
export function validBarcode(symbology: Symbology | 'qr', value: string): boolean {
  if (value === '') return false
  switch (symbology) {
    case 'code128': return /^[\x20-\x7e]+$/.test(value)
    case 'code39': return /^[A-Z0-9 \-.$/+%]+$/.test(value)
    case 'ean13': return /^\d{12,13}$/.test(value)
    case 'upca': return /^\d{11,12}$/.test(value)
    case 'datamatrix':
    case 'qr': return true
  }
}
