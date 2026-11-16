'use client'
import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'

import { layout, renderSvg, THERMAL_4X6, type LabelElement, type LabelTemplate, type Warning } from '../core/index.js'
import { LABELS_STYLES } from './styles.js'

export type TemplateEditorProps = {
  elements: LabelElement[]
  onChange: (elements: LabelElement[]) => void
  /** Label size in millimeters. */
  size: { width: number; height: number }
  /** Sample record as JSON text, to fill tokens in the preview. */
  sample?: string
}

const TYPES: LabelElement['type'][] = ['text', 'barcode', 'qr', 'image', 'line', 'box']
const SYMBOLOGIES = ['code128', 'code39', 'ean13', 'upca', 'datamatrix'] as const
export const DEFAULT_SAMPLE = '{\n  "name": "Example item",\n  "code": "ABC-123"\n}'

const NEW: Record<LabelElement['type'], LabelElement> = {
  text: { type: 'text', x: 5, y: 5, width: 40, height: 8, fontSize: 12, content: '{{name}}', overflow: 'shrink' },
  barcode: { type: 'barcode', x: 5, y: 20, width: 40, height: 15, symbology: 'code128', value: '{{code}}' },
  qr: { type: 'qr', x: 5, y: 40, width: 20, height: 20, value: '{{code}}' },
  image: { type: 'image', x: 5, y: 5, width: 20, height: 20, source: '' },
  line: { type: 'line', x: 5, y: 30, width: 40, height: 0, thickness: 0.25 },
  box: { type: 'box', x: 5, y: 5, width: 40, height: 20, thickness: 0.25 },
}

const name = (el: LabelElement, i: number) => `${i + 1}. ${el.type}${el.type === 'text' ? `: ${typeof el.content === 'string' ? el.content.slice(0, 20) : ''}` : ''}`

/** Layers list, inspector and live preview for one template. The drag-and-drop canvas is a later addition. */
export function TemplateEditor({ elements, onChange, size, sample = DEFAULT_SAMPLE }: TemplateEditorProps): ReactNode {
  const id = useId()
  const [selected, setSelected] = useState(0)
  const [hidden, setHidden] = useState<number[]>([])
  const [sampleText, setSampleText] = useState(sample)
  const [said, setSaid] = useState('')
  const sel = Math.min(selected, elements.length - 1)
  const el = elements[sel]

  const parsed = useMemo(() => {
    try {
      return { data: JSON.parse(sampleText) as unknown, error: '' }
    } catch {
      return { data: {}, error: 'The sample is not valid JSON, so the preview uses an empty record.' }
    }
  }, [sampleText])

  const { svg, warnings } = useMemo(() => {
    const shown = elements.map((e, i) => ({ e, i })).filter(({ i }) => !hidden.includes(i))
    const tpl: LabelTemplate = { key: 'preview', size, elements: shown.map((s) => s.e) }
    const r = layout(tpl, parsed.data, { ...THERMAL_4X6, width: size.width, height: size.height })
    const mapped: Array<Warning & { layer: number }> = r.warnings.map((w) => ({ ...w, layer: shown[w.element]!.i }))
    return { svg: renderSvg(r), warnings: mapped }
  }, [elements, hidden, size, parsed.data])

  const update = (patch: Record<string, unknown>) => onChange(elements.map((e, i) => (i === sel ? ({ ...e, ...patch } as LabelElement) : e)))
  const num = (key: string, label: string, step = 0.1) => (
    <label key={key}>
      {label}
      <input type="number" step={step} value={(el as unknown as Record<string, number>)[key] ?? 0} onChange={(e) => update({ [key]: Number(e.target.value) })} />
    </label>
  )
  const txt = (key: string, label: string, area = false) => (
    <label key={key}>
      {label}
      {area ? <textarea rows={3} value={String((el as unknown as Record<string, unknown>)[key] ?? '')} onChange={(e) => update({ [key]: e.target.value })} /> : <input type="text" value={String((el as unknown as Record<string, unknown>)[key] ?? '')} onChange={(e) => update({ [key]: e.target.value })} />}
    </label>
  )

  const move = (by: -1 | 1) => {
    const to = sel + by
    if (!el || to < 0 || to >= elements.length) return setSaid(`${name(el!, sel)} is already ${by < 0 ? 'first' : 'last'}.`)
    const next = [...elements]
    next.splice(sel, 1)
    next.splice(to, 0, el)
    setHidden(hidden.map((h) => (h === sel ? to : h === to ? sel : h)))
    onChange(next)
    setSelected(to)
    setSaid(`Moved ${el.type} to position ${to + 1} of ${elements.length}.`)
  }
  const remove = () => {
    if (!el) return
    onChange(elements.filter((_, i) => i !== sel))
    setHidden(hidden.filter((h) => h !== sel).map((h) => (h > sel ? h - 1 : h)))
    setSelected(Math.max(0, sel - 1))
    setSaid(`Deleted ${el.type}.`)
  }
  const toggle = () => {
    const off = hidden.includes(sel)
    setHidden(off ? hidden.filter((h) => h !== sel) : [...hidden, sel])
    setSaid(`${el?.type} ${off ? 'shown' : 'hidden'} in the preview.`)
  }
  const add = (type: LabelElement['type']) => {
    onChange([...elements, NEW[type]])
    setSelected(elements.length)
    setSaid(`Added ${type} at position ${elements.length + 1}.`)
  }
  const keys = (e: KeyboardEvent) => {
    const to = e.key === 'ArrowDown' ? sel + 1 : e.key === 'ArrowUp' ? sel - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? elements.length - 1 : null
    if (to === null) return
    e.preventDefault()
    setSelected(Math.max(0, Math.min(elements.length - 1, to)))
  }

  return (
    <div className="labels-editor">
      <style>{LABELS_STYLES}</style>
      <section aria-labelledby={`${id}-layers`}>
        <h3 id={`${id}-layers`}>Layers</h3>
        <ul className="labels-layers" role="listbox" aria-label="Layers" aria-activedescendant={el ? `${id}-l${sel}` : undefined} tabIndex={0} onKeyDown={keys}>
          {elements.map((e, i) => (
            <li key={i} id={`${id}-l${i}`} role="option" aria-selected={i === sel} data-hidden={hidden.includes(i)} onClick={() => setSelected(i)}>
              {name(e, i)}
              {hidden.includes(i) ? ' (hidden)' : ''}
            </li>
          ))}
        </ul>
        <div className="labels-actions">
          <button type="button" onClick={() => move(-1)} disabled={!el}>Move layer up</button>
          <button type="button" onClick={() => move(1)} disabled={!el}>Move layer down</button>
          <button type="button" onClick={toggle} disabled={!el}>{hidden.includes(sel) ? 'Show layer' : 'Hide layer'}</button>
          <button type="button" onClick={remove} disabled={!el}>Delete layer</button>
        </div>
        <label>
          Add a layer
          <select value="" onChange={(e) => e.target.value && add(e.target.value as LabelElement['type'])}>
            <option value="">Choose a type</option>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <p role="status" aria-live="polite">{said}</p>
      </section>

      <section aria-labelledby={`${id}-preview`}>
        <h3 id={`${id}-preview`}>Preview</h3>
        <div className="labels-preview" role="img" aria-label={`Label preview, ${size.width} by ${size.height} millimeters, ${elements.length - hidden.length} layers shown`} dangerouslySetInnerHTML={{ __html: svg }} />
        <label>
          Sample record (JSON)
          <textarea rows={5} value={sampleText} onChange={(e) => setSampleText(e.target.value)} aria-describedby={parsed.error ? `${id}-err` : undefined} />
        </label>
        {parsed.error ? <p id={`${id}-err`} className="labels-error" role="alert">{parsed.error}</p> : null}
        <h3>Warnings</h3>
        {warnings.length ? (
          <ul className="labels-warnings" aria-label="Warnings">
            {warnings.map((w, i) => <li key={i}>Layer {w.layer + 1}: {w.message}</li>)}
          </ul>
        ) : <p>No warnings for this sample.</p>}
      </section>

      <section aria-labelledby={`${id}-inspector`}>
        <h3 id={`${id}-inspector`}>Inspector</h3>
        {!el ? <p>No layers yet. Add one from the layers list.</p> : (
          <div>
            <p>Editing layer {sel + 1}, {el.type}.</p>
            {num('x', 'X position (mm)')}
            {num('y', 'Y position (mm)')}
            {num('width', 'Width (mm)')}
            {num('height', 'Height (mm)')}
            <label>
              Rotation
              <select value={el.rotation ?? 0} onChange={(e) => update({ rotation: Number(e.target.value) })}>
                {[0, 90, 180, 270].map((r) => <option key={r} value={r}>{r} degrees</option>)}
              </select>
            </label>
            {el.type === 'text' ? (
              <>
                {txt('content', 'Text, with {{field}} tokens', true)}
                {num('fontSize', 'Font size (pt)', 0.5)}
                <label>
                  When the text does not fit
                  <select value={el.overflow ?? 'shrink'} onChange={(e) => update({ overflow: e.target.value })}>
                    <option value="shrink">Shrink to fit</option>
                    <option value="ellipsis">Cut with an ellipsis</option>
                    <option value="wrap">Wrap to a maximum number of lines</option>
                  </select>
                </label>
                {el.overflow === 'wrap' ? num('maxLines', 'Maximum lines', 1) : null}
                <label className="labels-check"><input type="checkbox" checked={!!el.bold} onChange={(e) => update({ bold: e.target.checked })} /> Bold</label>
                <label className="labels-check"><input type="checkbox" checked={!!el.italic} onChange={(e) => update({ italic: e.target.checked })} /> Italic</label>
                <label>
                  Alignment
                  <select value={el.align ?? 'left'} onChange={(e) => update({ align: e.target.value })}>
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </label>
              </>
            ) : null}
            {el.type === 'barcode' ? (
              <>
                <label>
                  Barcode type
                  <select value={el.symbology} onChange={(e) => update({ symbology: e.target.value })}>
                    {SYMBOLOGIES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                {txt('value', 'Value, with {{field}} tokens')}
                <label className="labels-check"><input type="checkbox" checked={el.humanReadable !== false} onChange={(e) => update({ humanReadable: e.target.checked })} /> Show the value under the barcode</label>
              </>
            ) : null}
            {el.type === 'qr' ? txt('value', 'Value, with {{field}} tokens') : null}
            {el.type === 'image' ? txt('source', 'Upload id or {{field}} token') : null}
            {el.type === 'line' || el.type === 'box' ? num('thickness', 'Line thickness (mm)', 0.05) : null}
          </div>
        )}
      </section>
    </div>
  )
}
