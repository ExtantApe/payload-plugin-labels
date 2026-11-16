import { inchesToMm } from './units.js'
import type { ThermalMedia } from './types.js'

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

export const MEDIA_PRESETS: Record<string, ThermalMedia> = { [THERMAL_4X6.key]: THERMAL_4X6 }
