import type { Access, CollectionConfig, Config, Field, Plugin } from 'payload'

import type { LabelProvider } from './contracts/labels.js'

export * from './core/index.js'

type Check = (args: { req: { user?: unknown } }) => boolean | Promise<boolean>

export type LabelsOptions = {
  /** Plain Payload-style checks. Only an answer of exactly `true` passes; anything else, or an error, is a no. */
  access?: { print?: Check; manage?: Check }
  /** Templates and media belong to a site; a record with no site is shared. Needs `scopeCollection`. */
  scopeField?: string
  /** The collection the scope field points at, such as `tenants`. */
  scopeCollection?: string
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

export const TEMPLATES_SLUG = 'label-templates'
export const MEDIA_SLUG = 'label-media'
export const PRINTS_SLUG = 'label-prints'

export const labelsPlugin =
  (options: LabelsOptions = {}): Plugin =>
  (config: Config): Config => {
    if (options.scopeField && !options.scopeCollection) throw new Error('labels: scopeField needs scopeCollection')
    const manage = strict(options.access?.manage)
    const print = strict(options.access?.print)
    // Reading needs a person who may print or manage. With neither check given, a signed-in user may read.
    const read: Access = async (args) =>
      options.access?.print || options.access?.manage ? (await print(args)) === true || (await manage(args)) === true : Boolean(args.req.user)
    const scope: Field[] = options.scopeField
      ? [{ name: options.scopeField, type: 'relationship', relationTo: options.scopeCollection!, admin: { description: 'Leave empty to share with every site.' } }]
      : []
    const writes = { create: manage, update: manage, delete: manage }

    const templates: CollectionConfig = {
      slug: TEMPLATES_SLUG,
      admin: { useAsTitle: 'name', group: 'Labels' },
      access: { read, ...writes },
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'key', type: 'text', required: true, unique: true, index: true },
        { name: 'collection', type: 'text', required: true },
        { name: 'width', type: 'number', required: true, min: 1, admin: { description: 'Millimeters.' } },
        { name: 'height', type: 'number', required: true, min: 1, admin: { description: 'Millimeters.' } },
        { name: 'media', type: 'relationship', relationTo: MEDIA_SLUG },
        { name: 'elements', type: 'json', required: true, defaultValue: [] },
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
      access: { read, ...writes },
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'kind', type: 'select', required: true, options: ['thermal', 'sheet'] },
        { name: 'definition', type: 'json', required: true, admin: { description: 'Sizes in millimeters, as in the media presets.' } },
        ...scope,
      ],
    }
    const prints: CollectionConfig = {
      slug: PRINTS_SLUG,
      admin: { group: 'Labels', description: 'Who printed what. Ids and counts only, never the label text.' },
      access: { read: manage, create: never, update: never, delete: never },
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

    const custom = (config.custom ?? {}) as { labels?: { providers?: Record<string, LabelProvider> } }
    return {
      ...config,
      collections: [...(config.collections ?? []), templates, media, ...(options.log?.enabled === false ? [] : [prints])],
      custom: {
        ...custom,
        labels: { ...custom.labels, options: { ...options, log: { enabled: true, keepDays: 180, ...options.log } }, providers: custom.labels?.providers ?? {} },
      },
    }
  }
