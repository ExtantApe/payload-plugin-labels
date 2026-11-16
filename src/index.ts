import type { Access, CollectionConfig, Config, Field, Plugin, Where } from 'payload'

import type { LabelProvider } from './contracts/labels.js'
import { validateElements } from './core/validate.js'
import { printEndpoint } from './print.js'

export * from './core/index.js'

type Check = (args: { req: { user?: unknown } }) => boolean | Promise<boolean>

export type LabelsOptions = {
  /** Plain Payload-style checks. Only an answer of exactly `true` passes; anything else, or an error, is a no. */
  access?: { print?: Check; manage?: Check }
  /** Templates and media belong to a site; a record with no site is shared. Needs `scopeCollection`. */
  scopeField?: string
  /** The collection the scope field points at, such as `tenants`. */
  scopeCollection?: string
  /**
   * Which scope (site) the person belongs to: its id, `ALL_SCOPES` for a platform admin, or null for none. Needed with
   * `scopeField`. No answer, an error or null means no access at all.
   */
  scopeOf?: (args: { req: { user?: unknown } }) => ScopeAnswer | Promise<ScopeAnswer>
  /** The print log. Ids and counts only. Default on, 180 days. */
  log?: { enabled?: boolean; keepDays?: number }
}

const strict = (check?: Check): Access => async (args) => {
  if (!check) return false
  try {
    return (await check(args as never)) === true
  } catch {
    return false
  }
}
const never: Access = () => false

/** A platform admin's answer from `scopeOf`: every scope, including records shared by all. */
export const ALL_SCOPES = '*' as const
export type ScopeAnswer = string | number | typeof ALL_SCOPES | null | undefined

async function scopeFor(options: LabelsOptions, req: unknown): Promise<string | number | typeof ALL_SCOPES | null> {
  try {
    const a = await options.scopeOf?.({ req: req as { user?: unknown } })
    return a === ALL_SCOPES || typeof a === 'string' || typeof a === 'number' ? (a === '' ? null : a) : null
  } catch {
    return null
  }
}

export { MAX_LABELS } from './print.js'
export const TEMPLATES_SLUG = 'label-templates'
export const MEDIA_SLUG = 'label-media'
export const PRINTS_SLUG = 'label-prints'

export const labelsPlugin =
  (options: LabelsOptions = {}): Plugin =>
  (config: Config): Config => {
    if (!options.access?.manage && !options.access?.print) {
      throw new Error('labels: set access.manage (who may change templates and media) or access.print (who may print). With neither, nobody could use the plugin.')
    }
    const field = options.scopeField
    if (field && (!options.scopeCollection || !options.scopeOf)) throw new Error('labels: scopeField needs scopeCollection and scopeOf')
    const manage = strict(options.access?.manage)
    const print = strict(options.access?.print)
    // Reading templates and media needs a person who may manage or print (printing reads the template). No fallback.
    const read: Access = async (args) => (await manage(args)) === true || (await print(args)) === true
    // With a scope field, every answer is narrowed to the person's own scope. No scope means no access.
    const scoped = (base: Access, shared: boolean): Access => async (args) => {
      const ok = await base(args)
      if (ok !== true || !field) return ok
      const who = await scopeFor(options, args.req)
      if (who === null) return false
      if (who === ALL_SCOPES) return true
      const own: Where = { [field]: { equals: who } }
      return shared ? { or: [own, { [field]: { exists: false } }] } : own
    }
    const scopedCreate: Access = async (args) => {
      if ((await manage(args)) !== true) return false
      if (!field) return true
      const who = await scopeFor(options, args.req)
      if (who === null) return false
      if (who === ALL_SCOPES) return true
      const given = (args.data as Record<string, unknown> | undefined)?.[field]
      return given !== undefined && given !== null && String(given) === String(who)
    }
    const keepInScope: CollectionConfig['hooks'] = field
      ? {
          beforeChange: [
            async ({ data, req }) => {
              if (!req.user) return data
              const who = await scopeFor(options, req)
              if (who === null) throw new Error('labels: no scope for this user')
              const given = (data as Record<string, unknown>)[field]
              if (who !== ALL_SCOPES && String(given) !== String(who)) throw new Error('labels: a record can only belong to your own scope')
              return data
            },
          ],
        }
      : undefined
    const scope: Field[] = options.scopeField
      ? [{ name: options.scopeField, type: 'relationship', relationTo: options.scopeCollection!, admin: { description: 'Leave empty to share with every site.' } }]
      : []
    const writes = { create: scopedCreate, update: scoped(manage, false), delete: scoped(manage, false) }

    const templates: CollectionConfig = {
      slug: TEMPLATES_SLUG,
      admin: { useAsTitle: 'name', group: 'Labels' },
      access: { read: scoped(read, true), ...writes },
      hooks: keepInScope,
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'key', type: 'text', required: true, unique: true, index: true },
        { name: 'collection', type: 'text', required: true },
        { name: 'width', type: 'number', required: true, min: 1, admin: { description: 'Millimeters.' } },
        { name: 'height', type: 'number', required: true, min: 1, admin: { description: 'Millimeters.' } },
        { name: 'media', type: 'relationship', relationTo: MEDIA_SLUG },
        { name: 'elements', type: 'json', required: true, defaultValue: [], validate: (value: unknown) => validateElements(value) ?? true, admin: { components: { Field: '@extantape/payload-plugin-labels/client#TemplateEditorField' } } },
        { name: 'repeat', type: 'text' },
        { name: 'copies', type: 'number', defaultValue: 1, min: 1 },
        { name: 'active', type: 'checkbox', defaultValue: true },
        { name: 'notes', type: 'textarea' },
        ...scope,
      ],
    }
    const media: CollectionConfig = {
      slug: MEDIA_SLUG,
      admin: { useAsTitle: 'name', group: 'Labels' },
      access: { read: scoped(read, true), ...writes },
      hooks: keepInScope,
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'key', type: 'text', index: true, admin: { description: 'Optional short name to print with, such as my-sheet.' } },
        { name: 'kind', type: 'select', required: true, options: ['thermal', 'sheet'] },
        { name: 'definition', type: 'json', required: true, admin: { description: 'Sizes in millimeters, as in the media presets.' } },
        ...scope,
      ],
    }
    const prints: CollectionConfig = {
      slug: PRINTS_SLUG,
      admin: { group: 'Labels', description: 'Who printed what. Ids and counts only, never the label text.' },
      access: { read: scoped(manage, false), create: never, update: never, delete: never },
      fields: [
        { name: 'template', type: 'relationship', relationTo: TEMPLATES_SLUG },
        { name: 'collection', type: 'text' },
        { name: 'documentIds', type: 'json' },
        { name: 'labelCount', type: 'number' },
        { name: 'media', type: 'relationship', relationTo: MEDIA_SLUG },
        { name: 'printedBy', type: 'text' },
        ...scope,
      ],
    }

    const endpoint = printEndpoint({
      slugs: { templates: TEMPLATES_SLUG, prints: PRINTS_SLUG, media: MEDIA_SLUG },
      // access.print decides printing; without it, only access.manage may print. Only exactly true passes.
      mayPrint: async (req) => (options.access?.print ? (await print({ req } as never)) === true : (await manage({ req } as never)) === true),
      scope: async (req) => {
        if (!field) return { all: true }
        const who = await scopeFor(options, req)
        return who === null ? null : who === ALL_SCOPES ? { all: true } : { id: who }
      },
      scopeField: field,
      log: options.log?.enabled !== false,
    })
    const custom = (config.custom ?? {}) as { labels?: { providers?: Record<string, LabelProvider> } }
    return {
      ...config,
      endpoints: [...(config.endpoints ?? []), endpoint],
      collections: [...(config.collections ?? []), templates, media, ...(options.log?.enabled === false ? [] : [prints])],
      custom: {
        ...custom,
        labels: { ...custom.labels, options: { ...options, log: { enabled: true, keepDays: 180, ...options.log } }, providers: custom.labels?.providers ?? {} },
      },
    }
  }
