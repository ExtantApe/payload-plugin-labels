import type { PayloadRequest } from 'payload'

/** One step of a set. `via` says how its records are reached from the records it starts from. */
export type SetStep = {
  template?: unknown
  via?: 'self' | 'forward' | 'backward'
  /** forward: a dotted relationship field path (up to 4 segments). backward: the field in `collection` that points at the current record. */
  field?: string
  /** backward only: the collection to search. */
  collection?: string
  /** Start from this earlier step's records (1-based). Empty means the starting record. */
  from?: number
}

export type SetDoc = { id: string | number; key?: string; collection: string; steps?: SetStep[]; active?: boolean }
export type Item = { collection: string; doc: Record<string, unknown> }

/** A plain refusal with the status to send. */
export class Refusal extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

type Payload = PayloadRequest['payload']
const idOf = (v: unknown): string | number | undefined => (v && typeof v === 'object' ? (v as { id?: string | number }).id : typeof v === 'string' || typeof v === 'number' ? v : undefined)
const MAX_PATH = 4

async function readMany(payload: Payload, user: unknown, collection: string, ids: Array<string | number>): Promise<Item[]> {
  const unique = [...new Set(ids.map(String))]
  if (!unique.length) return []
  const res = await payload.find({ collection: collection as never, where: { id: { in: unique } } as never, limit: unique.length, pagination: false, user, overrideAccess: false, depth: 3 } as never)
  if (res.docs.length !== unique.length) throw new Refusal(403, 'One or more records in this set do not exist or you may not read them. Nothing was printed.')
  const byId = new Map(res.docs.map((d) => [String((d as { id: unknown }).id), d as unknown as Record<string, unknown>]))
  return unique.map((i) => ({ collection, doc: byId.get(i)! }))
}

/** The collection a relationship field points at. Polymorphic fields are read from the value itself. */
function target(payload: Payload, collection: string, name: string, value: unknown): string | undefined {
  const field = payload.collections[collection as never]?.config.flattenedFields.find((f) => f.name === name) as { type?: string; relationTo?: string | string[] } | undefined
  if (!field || field.type !== 'relationship') return undefined
  if (typeof field.relationTo === 'string') return field.relationTo
  const v = Array.isArray(value) ? value[0] : value
  return v && typeof v === 'object' && typeof (v as { relationTo?: unknown }).relationTo === 'string' ? (v as { relationTo: string }).relationTo : undefined
}

async function forward(payload: Payload, user: unknown, from: Item[], path: string): Promise<Item[]> {
  const parts = path.split('.')
  if (parts.length > MAX_PATH || parts.some((p) => !p)) throw new Refusal(422, `The path "${path}" is not valid. Use up to ${MAX_PATH} relationship fields, joined with dots.`)
  let current = from
  for (const part of parts) {
    const next = new Map<string, { collection: string; id: string | number }>()
    for (const it of current) {
      const value = it.doc[part]
      const to = target(payload, it.collection, part, value)
      if (!to) throw new Refusal(422, `"${part}" is not a relationship field on ${it.collection}.`)
      for (const v of Array.isArray(value) ? value : [value]) {
        const inner = v && typeof v === 'object' && 'relationTo' in (v as object) ? (v as { value?: unknown }).value : v
        const id = idOf(inner)
        if (id !== undefined) next.set(`${to}:${String(id)}`, { collection: to, id })
      }
    }
    const byCollection = new Map<string, Array<string | number>>()
    for (const r of next.values()) byCollection.set(r.collection, [...(byCollection.get(r.collection) ?? []), r.id])
    current = []
    for (const [c, ids] of byCollection) current.push(...(await readMany(payload, user, c, ids)))
  }
  return current
}

async function backward(payload: Payload, user: unknown, from: Item[], collection: string, field: string, limit: number): Promise<Item[]> {
  if (!payload.collections[collection as never]) throw new Refusal(422, `This set looks in ${collection}, which does not exist.`)
  if (!payload.collections[collection as never]?.config.flattenedFields.some((f) => f.name === field && f.type === 'relationship')) throw new Refusal(422, `"${field}" is not a relationship field on ${collection}.`)
  const out = new Map<string, Item>()
  for (const it of from) {
    const where = { [field]: { equals: (it.doc as { id: unknown }).id } }
    const readable = await payload.find({ collection: collection as never, where: where as never, limit: limit + 1, user, overrideAccess: false, depth: 3 } as never)
    // A filtered read hides records without saying so. Compare with the real count and refuse if any are hidden.
    const real = await payload.count({ collection: collection as never, where: where as never, overrideAccess: true })
    if (real.totalDocs !== readable.docs.length) throw new Refusal(403, `Some ${collection} records in this set may not be read by you. Nothing was printed.`)
    for (const d of readable.docs) out.set(String((d as { id: unknown }).id), { collection, doc: d as unknown as Record<string, unknown> })
    if (out.size > limit) break
  }
  return [...out.values()]
}

export type StepRun = { step: SetStep; items: Item[] }

/**
 * Walk a set from its starting record. Every record is read as the person, so an unreadable record refuses the run.
 * `limit` is the most records the whole set may reach (the label cap divided by copies); more is refused.
 */
export async function resolveSet(
  payload: Payload,
  user: unknown,
  set: SetDoc,
  startId: string | number,
  limit: number,
  tooMany: (n: number) => Refusal,
): Promise<StepRun[]> {
  if (!payload.collections[set.collection as never]) throw new Refusal(422, 'That set starts from a collection that does not exist.')
  if (!Array.isArray(set.steps) || !set.steps.length) throw new Refusal(422, 'That set has no steps.')
  const start = await readMany(payload, user, set.collection, [startId])
  const runs: StepRun[] = []
  let total = 0
  for (const [i, step] of set.steps.entries()) {
    const via = step.via ?? 'self'
    const n = step.from ?? 0
    if (!Number.isInteger(n) || n < 0 || n > i) throw new Refusal(422, `Step ${i + 1} must start from the starting record or an earlier step.`)
    const source = n === 0 ? start : runs[n - 1]!.items
    let items: Item[]
    if (via === 'self') items = source
    else if (via === 'forward') {
      if (!step.field) throw new Refusal(422, `Step ${i + 1} needs a relationship path.`)
      items = await forward(payload, user, source, step.field)
    } else if (via === 'backward') {
      if (!step.collection || !step.field) throw new Refusal(422, `Step ${i + 1} needs a collection and a field.`)
      items = await backward(payload, user, source, step.collection, step.field, limit)
    } else throw new Refusal(422, `Step ${i + 1} has an unknown way of reaching records.`)
    total += items.length
    if (total > limit) throw tooMany(total)
    runs.push({ step, items })
  }
  return runs
}
