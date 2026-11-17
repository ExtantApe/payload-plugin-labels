import type { Payload } from 'payload'

export const PRINTS_SLUG = 'label-prints'

/**
 * Deletes print-log entries older than `keepDays` (default: the plugin's `log.keepDays`, which is 180 unless set).
 * Anything but a whole number of 1 or more keeps everything. It covers every site's entries (it runs with
 * overrideAccess, so it is for the site's own scheduled job). Errors from the bulk delete are logged. The site schedules this, for example as a Payload job or a cron route. It deletes with
 * overrideAccess, which is why it is a server function you call yourself and not something the API exposes.
 * Returns how many entries were removed.
 */
export async function pruneLabelPrints(payload: Payload, options: { keepDays?: number; now?: Date } = {}): Promise<number> {
  const configured = (payload.config.custom as { labels?: { options?: { log?: { keepDays?: number } } } } | undefined)?.labels?.options?.log?.keepDays
  const keepDays = options.keepDays ?? configured ?? 180
  if (typeof keepDays !== 'number' || !Number.isInteger(keepDays) || keepDays < 1) return 0
  if (!payload.collections[PRINTS_SLUG as never]) return 0
  const cutoff = new Date((options.now ?? new Date()).getTime() - keepDays * 86_400_000).toISOString()
  const res = await payload.delete({ collection: PRINTS_SLUG as never, where: { createdAt: { less_than: cutoff } } as never, overrideAccess: true })
  if (res.errors?.length) payload.logger.error(`labels: ${res.errors.length} print-log entries could not be deleted`)
  return res.docs.length
}
