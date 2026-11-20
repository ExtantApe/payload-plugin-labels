import type { Endpoint, PayloadRequest } from 'payload'

import { Refusal, resolveSet, type SetDoc } from './sets.js'
import { uploadLoader } from './images.js'
import { layout, MEDIA_PRESETS, parseMedia, resolveImages, THERMAL_4X6, type LabelElement, type LabelMedia, type LabelTemplate } from './core/index.js'

/** The most labels one request may print (documents times copies). A guess for what renders in a few seconds. */
export const MAX_LABELS = 2000

export type PrintDeps = {
  slugs: { templates: string; prints: string; media: string; sets: string }
  /** `strict` answer of the site's print check. */
  mayPrint: (req: PayloadRequest) => Promise<boolean>
  /** The person's scope: null for none, `{ all: true }` for a platform admin, else `{ id }`. Without a scope field: `{ all: true }`. */
  scope: (req: PayloadRequest) => Promise<{ all: true } | { id: string | number } | null>
  scopeField?: string
  uploads: string[]
  log: boolean
}

type TemplateDoc = { id: string | number; key: string; collection: string; width: number; height: number; media?: unknown; elements: unknown; active?: boolean; copies?: number }

/** Find a template by key, then by its id as given. Reads as the person, so access and scope rules apply. */
export async function findTemplate(payload: PayloadRequest['payload'], slug: string, ref: string, user: unknown): Promise<TemplateDoc | undefined> {
  const opts = { user, overrideAccess: false, depth: 0 } as never
  const byKey = await payload.find({ collection: slug as never, where: { key: { equals: ref } } as never, limit: 1, ...(opts as object) })
  if (byKey.docs[0]) return byKey.docs[0] as unknown as TemplateDoc
  try {
    return (await payload.findByID({ collection: slug as never, id: ref, ...(opts as object) })) as unknown as TemplateDoc
  } catch {
    return undefined
  }
}

const idOf = (v: unknown): string | number | undefined => (v && typeof v === 'object' ? (v as { id?: string | number }).id : typeof v === 'string' || typeof v === 'number' ? v : undefined)

/** A media by preset key, else a stored media by key, then id as given, read as the person. A string is the refusal message. */
export async function findMedia(payload: PayloadRequest['payload'], slug: string, ref: string | number, user: unknown): Promise<LabelMedia | string> {
  if (typeof ref === 'string' && Object.hasOwn(MEDIA_PRESETS, ref)) return MEDIA_PRESETS[ref]!
  const opts = { user, overrideAccess: false, depth: 0 }
  let doc = (await payload.find({ collection: slug as never, where: { key: { equals: String(ref) } } as never, limit: 1, ...opts })).docs[0] as unknown as Record<string, unknown> | undefined
  if (!doc) {
    try {
      doc = (await payload.findByID({ collection: slug as never, id: ref, ...opts })) as unknown as Record<string, unknown>
    } catch {
      doc = undefined
    }
  }
  if (!doc) return 'That media does not exist or you may not use it.'
  return parseMedia(doc.kind, typeof doc.key === 'string' && doc.key ? doc.key : String(doc.id), String(doc.name ?? ''), doc.definition)
}

/** A set by key, then by its id as given, read as the person. */
export async function findSet(payload: PayloadRequest['payload'], slug: string, ref: string, user: unknown): Promise<SetDoc | undefined> {
  const opts = { user, overrideAccess: false, depth: 0 }
  const byKey = await payload.find({ collection: slug as never, where: { key: { equals: ref } } as never, limit: 1, ...opts })
  if (byKey.docs[0]) return byKey.docs[0] as unknown as SetDoc
  try {
    return (await payload.findByID({ collection: slug as never, id: ref, ...opts })) as unknown as SetDoc
  } catch {
    return undefined
  }
}

function checkTemplate(payload: PayloadRequest['payload'], tpl: TemplateDoc): { status: number; message: string } | undefined {
  if (!Array.isArray(tpl.elements) || !(tpl.width > 0) || !(tpl.height > 0)) return { status: 422, message: 'That template is not complete.' }
  if (!payload.collections[tpl.collection as never]) return { status: 422, message: 'That template prints from a collection that does not exist.' }
  return undefined
}

const refuse = (status: number, message: string) => Response.json({ message }, { status })

/**
 * POST /api/labels/print with `{ template, ids, copies? }` returns a PDF, one label per page. It fails closed: no
 * sign-in, no print right, no scope, another scope's template, a record the person can't read, or too many labels is
 * a plain refusal. Records are read with the person's own access (never overrideAccess), and one log entry holds ids
 * and counts only.
 */
export const printEndpoint = (deps: PrintDeps): Endpoint => ({
  path: '/labels/print',
  method: 'post',
  handler: async (req) => {
    const { payload, user } = req
    if (!user) return refuse(401, 'Sign in to print labels.')
    if (!(await deps.mayPrint(req))) return refuse(403, 'You may not print labels.')
    const scope = await deps.scope(req)
    if (!scope) return refuse(403, 'Your account is not set up for any site, so it cannot print labels.')

    let body: { template?: unknown; set?: unknown; id?: unknown; ids?: unknown; match?: unknown; copies?: unknown; media?: unknown; start?: unknown }
    try {
      body = (await req.json?.()) as typeof body
    } catch {
      return refuse(400, 'The request was not valid JSON.')
    }
    const isSet = body?.set !== undefined
    const copies = body?.copies === undefined ? 1 : body.copies
    if (isSet && (body.match !== undefined)) return refuse(400, 'A set prints from one starting record. match works with a template only.')
    if (isSet === (body?.template !== undefined)) return refuse(400, 'Say which template or which set to print.')
    if (typeof copies !== 'number' || !Number.isInteger(copies) || copies < 1) return refuse(400, 'Copies must be a whole number of 1 or more.')
    const tooMany = (n: number) => new Refusal(413, `That is ${n * copies} labels. One request prints at most ${MAX_LABELS}.`)

    type Job = { tpl: TemplateDoc; doc: unknown }
    const jobs: Job[] = []
    let ids: string[] = []
    let setDoc: SetDoc | undefined
    let logTemplate: TemplateDoc | undefined
    let matchCollection = ''
    try {
      if (!isSet) {
        if (typeof body.template !== 'string' && typeof body.template !== 'number') return refuse(400, 'Say which template to print.')
        const matching = body.match !== undefined
        if (matching && body.ids !== undefined) return refuse(400, 'Send either ids or match, not both.')
        let filter: { where?: Record<string, unknown>; sort?: string } = {}
        if (matching) {
          const m = body.match as { collection?: unknown; where?: unknown; sort?: unknown } | null
          if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.collection !== 'string') return refuse(400, 'match needs the collection to search, such as { "collection": "orders" }.')
          if (m.where !== undefined && (!m.where || typeof m.where !== 'object' || Array.isArray(m.where))) return refuse(400, 'match.where must be a Payload filter object.')
          if (m.sort !== undefined && typeof m.sort !== 'string') return refuse(400, 'match.sort must be a field name.')
          filter = { where: m.where as Record<string, unknown> | undefined, sort: m.sort as string | undefined }
          matchCollection = m.collection
        } else {
          ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((i): i is string | number => typeof i === 'string' || typeof i === 'number').map(String))] : []
          if (!ids.length) return refuse(400, 'Pick at least one document.')
          if (ids.length * copies > MAX_LABELS) return refuse(413, `That is ${ids.length * copies} labels. One request prints at most ${MAX_LABELS}.`)
        }
        // The template: by key first, then by id exactly as given, both as the person (scope rules apply).
        const tpl = await findTemplate(payload, deps.slugs.templates, String(body.template), user)
        if (!tpl || tpl.active === false) return refuse(403, 'That template does not exist or you may not use it.')
        const bad = checkTemplate(payload, tpl)
        if (bad) return refuse(bad.status, bad.message)
        logTemplate = tpl
        if (matching) {
          if (matchCollection !== tpl.collection) return refuse(422, `That template prints from ${tpl.collection}, but the filter is on ${matchCollection}.`)
          // The same filter the list used, run here as the person: their read access narrows it, never widens it.
          const query = { collection: tpl.collection as never, ...(filter.where ? { where: filter.where as never } : {}), ...(filter.sort ? { sort: filter.sort } : {}), user, overrideAccess: false }
          try {
            const n = (await payload.count({ collection: tpl.collection as never, ...(filter.where ? { where: filter.where as never } : {}), user, overrideAccess: false })).totalDocs
            if (n === 0) return refuse(422, 'No documents match that filter, so there is nothing to print.')
            if (n * copies > MAX_LABELS) return refuse(413, `That is ${n * copies} labels. One request prints at most ${MAX_LABELS}.`)
            const found = await payload.find({ ...query, limit: Math.min(n, MAX_LABELS) + 1, pagination: false, depth: 3 })
            // The set can change between the count and the read. Check again so the cap holds for what prints.
            if (found.docs.length * copies > MAX_LABELS) return refuse(413, `That is ${found.docs.length * copies} labels. One request prints at most ${MAX_LABELS}.`)
            if (!found.docs.length) return refuse(422, 'No documents match that filter, so there is nothing to print.')
            ids = found.docs.map((d) => String((d as { id: unknown }).id))
            for (const d of found.docs) for (let c = 0; c < copies; c++) jobs.push({ tpl, doc: d })
          } catch (e) {
            if (e instanceof Refusal) throw e
            return refuse(400, 'That filter could not be used. Reload the list and try again.')
          }
        } else {
          // The documents: Payload's own access for their collection, as the person. Any one missing refuses the lot.
          const docs = await payload.find({ collection: tpl.collection as never, where: { id: { in: ids } } as never, limit: ids.length, pagination: false, user, overrideAccess: false, depth: 3 })
          if (docs.docs.length !== ids.length) return refuse(403, 'One or more of those documents does not exist or you may not read them. Nothing was printed.')
          const byId = new Map(docs.docs.map((d) => [String((d as { id: unknown }).id), d]))
          for (const id of ids) for (let c = 0; c < copies; c++) jobs.push({ tpl, doc: byId.get(id) })
        }
      } else {
        const startId = body.id
        if (typeof body.set !== 'string' && typeof body.set !== 'number') return refuse(400, 'Say which set to print.')
        if (typeof startId !== 'string' && typeof startId !== 'number') return refuse(400, 'Say which document to start from.')
        ids = [String(startId)]
        // The set is read as the person, so scope rules apply to it as to a template.
        setDoc = await findSet(payload, deps.slugs.sets, String(body.set), user)
        if (!setDoc || setDoc.active === false) return refuse(403, 'That set does not exist or you may not use it.')
        const runs = await resolveSet(payload, user, setDoc, startId, Math.floor(MAX_LABELS / copies), tooMany)
        for (const { step, items } of runs) {
          const ref = step.template && typeof step.template === 'object' ? (step.template as { id?: unknown }).id : step.template
          const tpl = typeof ref === 'string' || typeof ref === 'number' ? await findTemplate(payload, deps.slugs.templates, String(ref), user) : undefined
          if (!tpl || tpl.active === false) return refuse(403, 'A template in that set does not exist or you may not use it.')
          const bad = checkTemplate(payload, tpl)
          if (bad) return refuse(bad.status, bad.message)
          logTemplate ??= tpl
          for (const it of items) {
            if (it.collection !== tpl.collection) return refuse(422, `The template ${tpl.key} prints from ${tpl.collection}, but a step of this set reaches ${it.collection}.`)
            for (let c = 0; c < copies; c++) jobs.push({ tpl, doc: it.doc })
          }
        }
      }
    } catch (e) {
      if (e instanceof Refusal) return refuse(e.status, e.message)
      throw e
    }
    if (!jobs.length) return refuse(422, 'There is nothing to print: the set reached no records.')
    const total = jobs.length
    if (total > MAX_LABELS) return refuse(413, `That is ${total} labels. One request prints at most ${MAX_LABELS}.`)

    // Media: the request's, else the first template's own, else 4 x 6 in thermal. Start slot is 1-based for people.
    if (body.media !== undefined && typeof body.media !== 'string' && typeof body.media !== 'number') return refuse(400, 'Media must be a media key.')
    const mediaRef = body.media ?? idOf(jobs[0]!.tpl.media)
    const media = mediaRef === undefined ? THERMAL_4X6 : await findMedia(payload, deps.slugs.media, mediaRef, user)
    if (typeof media === 'string') return refuse(body.media === undefined ? 422 : 400, media)
    let start = 0
    if (body.start !== undefined) {
      if (media.kind !== 'sheet') return refuse(400, 'A start slot only applies to sheet media.')
      const per = media.columns * media.rows
      if (typeof body.start !== 'number' || !Number.isInteger(body.start) || body.start < 1 || body.start > per) return refuse(400, `The start slot must be a whole number from 1 to ${per} for ${media.name}.`)
      start = body.start - 1
    }
    if (media.kind === 'sheet') {
      for (const { tpl } of jobs) if (tpl.width > media.width + 0.5 || tpl.height > media.height + 0.5) return refuse(422, `That template (${tpl.width} x ${tpl.height} mm) is larger than the labels on ${media.name} (${media.width} x ${media.height} mm).`)
    }

    const printedAt = new Date().toISOString()
    const u = user as { name?: unknown }
    const results = jobs.map(({ tpl, doc }, i) => {
      const template: LabelTemplate = { key: tpl.key, size: { width: tpl.width, height: tpl.height }, elements: tpl.elements as LabelElement[] }
      return layout(template, doc, media.kind === 'sheet' ? { ...media, offset: { x: 0, y: 0 } } : media, { label: { number: i + 1, of: total }, printedAt, printedBy: { name: typeof u.name === 'string' ? u.name : '' } })
    })
    const load = uploadLoader({ payload, user, uploads: deps.uploads })
    const withImages = await Promise.all(results.map((r) => (r.marks.some((m) => m.type === 'image') ? resolveImages(r, load) : r)))
    const { renderPdf } = await import('./pdf.js')
    const pdf = await renderPdf(withImages, media, start)

    if (deps.log) {
      const scoped = (setDoc ?? logTemplate) as unknown as Record<string, unknown> | undefined
      const tplScope = deps.scopeField ? scoped?.[deps.scopeField] : undefined
      const scopeValue = 'id' in scope ? scope.id : tplScope && typeof tplScope === 'object' ? (tplScope as { id?: unknown }).id : tplScope
      try {
        await payload.create({
          collection: deps.slugs.prints as never,
          data: { ...(setDoc ? { set: setDoc.id, collection: setDoc.collection } : { template: logTemplate!.id, collection: logTemplate!.collection }), documentIds: ids, labelCount: total, media: media.key, ...(media.kind === 'sheet' ? { startSlot: start + 1 } : {}), printedBy: String((user as { id: unknown }).id), ...(deps.scopeField && scopeValue ? { [deps.scopeField]: scopeValue } : {}) } as never,
          overrideAccess: true,
        })
      } catch {
        return refuse(500, 'The print log could not be written, so nothing was printed.')
      }
    }
    return new Response(new Blob([pdf as Uint8Array<ArrayBuffer>]), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="labels.pdf"', 'X-Label-Count': String(total), 'X-Document-Count': String(ids.length) } })
  },
})
