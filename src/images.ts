import { open, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

import type { Payload } from 'payload'

import type { ImageLoader, LoadedImage } from './core/index.js'

/** The largest picture one label may carry. A limit so one upload cannot stall a run of 2,000 labels. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** One request may load at most this many image bytes in total (each picture is read once, however many labels use it). */
export const MAX_TOTAL_IMAGE_BYTES = 25 * 1024 * 1024
/** PNGs with transparency inflate to width x height x 4 bytes in memory, so the pixel count is limited. */
export const MAX_PNG_PIXELS = 16_000_000

const PNG = [0x89, 0x50, 0x4e, 0x47]
const JPEG = [0xff, 0xd8, 0xff]
const starts = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v)

/**
 * Loads pictures from the site's own upload collections, as the person (their access rules apply), and nothing else.
 * A source is `collection:id`, or just an id when one upload collection is allowed. A URL is never fetched. Only PNG
 * and JPEG files that sit in the collection's own static folder are read, and the file's bytes must match its type.
 */
export function uploadLoader(args: { payload: Payload; user: unknown; uploads: string[]; maxTotalBytes?: number }): ImageLoader {
  const cap = args.maxTotalBytes ?? MAX_TOTAL_IMAGE_BYTES
  const overCap = 'The pictures on these labels add up to more than this request may load.'
  // Bytes reserved so far. A file's size is added before it is read, and loads run one at a time, so the running total
  // is always current and nothing past the cap is ever read.
  let total = 0
  let full = false
  let queue: Promise<unknown> = Promise.resolve()
  const cache = new Map<string, Promise<LoadedImage | string>>()
  const one = async (source: string): Promise<LoadedImage | string> => {
    if (full) return overCap
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source) || source.startsWith('//')) return 'Images from a web address are not fetched. Use an upload.'
    const [slug, id] = source.includes(':') ? (source.split(':', 2) as [string, string]) : [args.uploads.length === 1 ? args.uploads[0]! : '', source]
    if (!slug || !args.uploads.includes(slug)) return 'That image is not in an upload collection this site allows for labels.'
    const dir = (args.payload.collections as Record<string, { config?: { upload?: { staticDir?: string; disableLocalStorage?: boolean } | boolean } } | undefined>)[slug]?.config?.upload
    const staticDir = typeof dir === 'object' && !dir.disableLocalStorage ? dir.staticDir : undefined
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
    // The size is checked before the file is read, so a huge upload never reaches memory. A relative staticDir is
    // resolved against the server's working folder.
    const file = join(staticDir, basename(doc.filename))
    const size = (await stat(file)).size
    if (size > MAX_IMAGE_BYTES) return `That image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`
    if (total + size > cap) {
      full = true
      return overCap
    }
    total += size
    const handle = await open(file, 'r')
    let data: Uint8Array
    try {
      const buf = Buffer.alloc(size)
      const { bytesRead } = await handle.read(buf, 0, size, 0)
      data = new Uint8Array(buf.subarray(0, bytesRead))
    } finally {
      await handle.close()
    }
    if (!starts(data, mime === 'image/png' ? PNG : JPEG)) return 'That file is not really a PNG or JPEG.'
    if (mime === 'image/png') {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      if (data.length < 24) return 'That file is not really a PNG or JPEG.'
      const w = view.getUint32(16)
      const h = view.getUint32(20)
      if (!w || !h || w * h > MAX_PNG_PIXELS) return `That PNG is larger than ${MAX_PNG_PIXELS / 1_000_000} megapixels.`
    }
    return { mime, data }
  }
  return (source) => {
    let p = cache.get(source)
    if (!p) {
      // One load at a time: each waits for the one before it to finish.
      p = queue.then(() => one(source)).catch(() => 'The image could not be read.')
      queue = p
      cache.set(source, p)
    }
    return p
  }
}
