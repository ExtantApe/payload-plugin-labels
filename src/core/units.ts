export const MM_PER_INCH = 25.4
export const MM_PER_POINT = 25.4 / 72
export const inchesToMm = (inches: number): number => round(inches * MM_PER_INCH)
export const mmToInches = (mm: number): number => round(mm / MM_PER_INCH, 4)
export const pointsToMm = (pt: number): number => pt * MM_PER_POINT
export function round(n: number, places = 3): number {
  const f = 10 ** places
  return Math.round(n * f) / f
}
