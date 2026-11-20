'use client'
import { useConfig, useDocumentInfo, useListQuery, useSelection } from '@payloadcms/ui'
import { mergeListSearchAndWhere } from 'payload/shared'

import { PrintLabelsDialog } from './PrintLabelsDialog.js'

/** On a document's edit view: prints labels for this document. */
export function EditViewPrintButton() {
  const { collectionSlug, id } = useDocumentInfo()
  const { config } = useConfig()
  if (!collectionSlug || id === undefined || id === null) return null
  return <PrintLabelsDialog collection={collectionSlug} ids={[id]} apiRoute={config.routes.api} />
}

/**
 * On a collection's list view: prints labels for the selected rows. When every row on the page is selected and more
 * match the filter, the dialog offers "Select all N matching"; the server then finds those documents from the same
 * filter (and the person's own access), so the ids of other pages never travel through the browser.
 */
export function ListViewPrintButton({ collectionSlug }: { collectionSlug?: string }) {
  const { selectAll, selectedIDs, toggleAll, totalDocs } = useSelection()
  const { query } = useListQuery()
  const { config, getEntityConfig } = useConfig()
  if (!collectionSlug) return null
  const collectionConfig = getEntityConfig({ collectionSlug })
  const where = collectionConfig ? mergeListSearchAndWhere({ collectionConfig: collectionConfig as never, search: typeof query?.search === 'string' ? query.search : '', where: (query?.where ?? {}) as never }) : (query?.where ?? {})
  const hasWhere = Object.keys(where as object).length > 0
  const sort = typeof query?.sort === 'string' ? query.sort : undefined
  const everything = selectAll === 'allAvailable'
  const matching = {
    total: totalDocs ?? 0,
    offer: selectAll === 'allInPage' && (totalDocs ?? 0) > selectedIDs.length,
    selected: everything && (totalDocs ?? 0) > 0,
    select: () => toggleAll(true),
    ...(hasWhere ? { where } : {}),
    ...(sort ? { sort } : {}),
  }
  return <PrintLabelsDialog collection={collectionSlug} ids={selectedIDs} apiRoute={config.routes.api} matching={matching} />
}
