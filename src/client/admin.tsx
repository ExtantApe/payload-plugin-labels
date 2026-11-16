'use client'
import { useConfig, useDocumentInfo, useSelection } from '@payloadcms/ui'

import { PrintLabelsDialog } from './PrintLabelsDialog.js'

/** On a document's edit view: prints labels for this document. */
export function EditViewPrintButton() {
  const { collectionSlug, id } = useDocumentInfo()
  const { config } = useConfig()
  if (!collectionSlug || id === undefined || id === null) return null
  return <PrintLabelsDialog collection={collectionSlug} ids={[id]} apiRoute={config.routes.api} />
}

/** On a collection's list view: prints labels for the selected rows. */
export function ListViewPrintButton({ collectionSlug }: { collectionSlug?: string }) {
  const { selectedIDs } = useSelection()
  const { config } = useConfig()
  if (!collectionSlug) return null
  return <PrintLabelsDialog collection={collectionSlug} ids={selectedIDs} apiRoute={config.routes.api} />
}
