import type { LayoutResult, LoadedImage, Mark } from './types.js'

/** Gets a picture for an element's source, or says why it can't (a plain reason). */
export type ImageLoader = (source: string) => Promise<LoadedImage | string>

/**
 * Fills each image mark with its picture. A source that is empty, refused or fails to load keeps the placeholder
 * box and adds a warning, so one bad picture never stops a run.
 */
export async function resolveImages(result: LayoutResult, load: ImageLoader): Promise<LayoutResult> {
  const warnings = [...result.warnings]
  const marks: Mark[] = []
  for (const m of result.marks) {
    if (m.type !== 'image') {
      marks.push(m)
      continue
    }
    let got: LoadedImage | string
    try {
      got = m.source ? await load(m.source) : 'No image is set.'
    } catch {
      got = 'The image could not be read.'
    }
    if (typeof got === 'string') {
      warnings.push({ element: m.element, kind: 'image', message: got })
      marks.push(m)
    } else marks.push({ ...m, image: got })
  }
  return { ...result, marks, warnings }
}
