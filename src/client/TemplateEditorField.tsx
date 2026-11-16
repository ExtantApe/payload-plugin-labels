'use client'
import { useField, useFormFields } from '@payloadcms/ui'
import type { ReactNode } from 'react'

import type { LabelElement } from '../core/index.js'
import { TemplateEditor } from './TemplateEditor.js'

/** Payload field component for a template's `elements`: the layers list, inspector and live preview. */
export function TemplateEditorField({ path }: { path: string }): ReactNode {
  const { value, setValue } = useField<LabelElement[]>({ path })
  const width = useFormFields(([f]) => f.width?.value) as number | undefined
  const height = useFormFields(([f]) => f.height?.value) as number | undefined
  return <TemplateEditor elements={Array.isArray(value) ? value : []} onChange={setValue} size={{ width: width || 100, height: height || 50 }} />
}
