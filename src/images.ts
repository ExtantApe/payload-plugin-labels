import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import type { Payload } from 'payload'

import type { ImageLoader, LoadedImage } from './core/index.js'

/** The largest picture one label may carry. A limit so one upload cannot stall a run of 2,000 labels. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const PNG = [0x89, 0x50, 0x4e, 0x47]
const JPEG = [0xff, 0xd8, 0xff]
const starts = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v)

/**
 * Loads pictures from the site's own upload collections, as the person (their access rules apply), and nothing else.
 * A source is `collection:id`, or just an id when one upload collection is allowed. A URL is never fetched. Only PNG
 * and JPEG files that sit in the collection's own static folder are read, and the file's bytes must match its type.
 */
export function uploadLoader(args: { payload: Payload; user: unknown; uploads: string[] }): ImageLoader {
  const cache = new Map<string, Promise<LoadedImage | string>>()
  const one = async (source: string): Promise<LoadedImage | string> => {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source) || source.startsWith('//')) return 'Images from a web address are not fetched. Use an upload.'
    const [slug, id] = source.includes(':') ? (source.split(':', 2) as [string, string]) : [args.uploads.length === 1 ? args.uploads[0]! : '', source]
    if (!slug || !args.uploads.includes(slug)) return 'That image is not in an upload collection this site allows for labels.'
    const dir = (args.payload.collections as Record<string, { config?: { upload?: { staticDir?: string } | boolean } } | undefined>)[slug]?.config?.upload
    const staticDir = typeof dir === 'object' ? dir.staticDir : undefined
    if (!staticDir) return 'That upload collection does not store files on this server, so its images cannot be printed.'
    let doc: { filename?: unknown; mimeType?: unknown }
    try {
      doc = (await args.payload.findByID({ collection: slug as never, id, user: args.user as never, overrideAccess: false, depth: 0 })) as never
    } catch {
      return 'That image does not exist or you may not read it.'
    }
    const mime = doc.mimeType === 'image/png' || doc.mimeType === 'image/jpeg' ? doc.mimeType : undefined
    if (!mime) return 'Only PNG and JPEG images can be printed.'
    if (typeof doc.filename !== 'string' || !doc.filename) return 'That image has no file.'
    const data = new Uint8Array(await readFile(join(staticDir, basename(doc.filename))))
    if (data.length > MAX_IMAGE_BYTES) return `That image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`
    if (!starts(data, mime === 'image/png' ? PNG : JPEG)) return 'That file is not really a PNG or JPEG.'
    return { mime, data }
  }
  return (source) => { 
    let p = cache.get(source)
    if (!p) cache.set(source, (p = one(source).catch(() => 'The image could not be read.')))
    return p
  }
}
