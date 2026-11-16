/**
 * The contract other plugins and sites use to offer labels. Types only, no imports, so a provider can copy it or
 * import it without pulling in anything. Labels reads `config.custom.labels.providers` at request time.
 */
import type { LabelElement, LabelMedia, LabelSize } from '../core/types.js'

/** A ready-made template. It is copied into an editable record only when someone picks it. */
export type LabelTemplatePreset = {
  key: string
  name: string
  collection: string
  size: LabelSize
  elements: LabelElement[]
  /** An array field to print one label per row of, such as order lines. */
  repeat?: string
  copies?: number
  /** A media preset key, such as `thermal-4x6`. */
  media?: string
}

/** One step of a set: a template, for the document itself or for related documents reached through a relationship. */
export type LabelSetStep = {
  template: string
  /** Omitted: the document itself. Set: print for each document in `collection` whose `field` points at this one. */
  related?: { collection: string; field: string }
}

/** A named list of steps on one collection, such as "All labels for this order". */
export type LabelSetPreset = {
  key: string
  name: string
  collection: string
  steps: LabelSetStep[]
}

export type LabelProvider = {
  /** Shown in the template library, such as "Kitting". Also the namespace of its tokens. */
  name: string
  templates?: LabelTemplatePreset[]
  sets?: LabelSetPreset[]
  /** Extra tokens under the provider's namespace. `payload` and `req` are Payload's, typed loosely to stay import-free. */
  tokens?: (args: { collection: string; doc: object; payload: unknown; req: unknown }) => Promise<Record<string, unknown>>
}

export type { LabelMedia }
