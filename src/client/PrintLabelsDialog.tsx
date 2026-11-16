'use client'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { MEDIA_PRESETS, THERMAL_4X6, parseMedia, type LabelMedia } from '../core/index.js'

type TemplateRow = { id: string | number; key: string; name?: string; media?: unknown }
type MediaRow = { id: string | number; key?: string; name?: string; kind?: string; definition?: unknown }
type Props = {
  /** The collection whose documents are printed. */
  collection: string
  /** The documents to print labels for. */
  ids: Array<string | number>
  /** Payload's API route. Default `/api`. */
  apiRoute?: string
}

const CSS = `
.labels-dialog-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:1000}
.labels-dialog{background:var(--theme-elevation-0,#fff);color:var(--theme-text,#111);max-width:34rem;width:92vw;max-height:90vh;overflow:auto;padding:1.25rem;border-radius:6px;display:grid;gap:.9rem}
.labels-dialog label,.labels-dialog legend{font-weight:600;display:block;margin-bottom:.25rem}
.labels-dialog select,.labels-dialog input,.labels-dialog button,.labels-dialog a{font:inherit}
.labels-dialog select,.labels-dialog input{padding:.4rem;min-height:2.25rem;width:100%;box-sizing:border-box}
.labels-dialog button,.labels-dialog a.labels-link{padding:.45rem .9rem;min-height:2.25rem;min-width:2.25rem;cursor:pointer;display:inline-block;box-sizing:border-box}
.labels-dialog :focus-visible,.labels-open:focus-visible{outline:3px solid #1d4ed8;outline-offset:2px}
.labels-slots{display:grid;gap:4px}
.labels-slot{border:1px solid #555;background:transparent;color:inherit;font-size:.8rem}
.labels-slot[aria-checked="true"]{background:#1d4ed8;color:#fff;border-color:#1d4ed8}
.labels-error{border:2px solid #b91c1c;padding:.5rem;color:#7f1d1d;background:#fee2e2}
`

const errorText = async (r: Response): Promise<string> => {
  try {
    const j = (await r.json()) as { message?: unknown }
    if (typeof j.message === 'string' && j.message) return j.message
  } catch {
    /* fall through */
  }
  return r.status === 401 ? 'Sign in again to print labels.' : r.status === 403 ? 'You may not print these labels.' : `The server could not print the labels (error ${r.status}).`
}

/** The "Print labels" button and its dialog. Needs no Payload imports, so it can be tested and reused on its own. */
export function PrintLabelsDialog({ collection, ids, apiRoute = '/api' }: Props) {
  const uid = useId()
  const [open, setOpen] = useState(false)
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [stored, setStored] = useState<MediaRow[]>([])
  const [loadError, setLoadError] = useState('')
  const [template, setTemplate] = useState('')
  const [mediaChoice, setMediaChoice] = useState('') // '' means the template's own media
  const [start, setStart] = useState(1)
  const [copies, setCopies] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ url: string; text: string } | null>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const slots = useRef<Array<HTMLButtonElement | null>>([])

  const close = useCallback(() => {
    setOpen(false)
    queueMicrotask(() => opener.current?.focus())
  }, [])

  // Load the person's templates for this collection and the stored media, as the person.
  useEffect(() => {
    if (!open) return
    let live = true
    setLoadError('')
    const get = async (path: string) => {
      const r = await fetch(`${apiRoute}${path}`, { credentials: 'include' })
      if (!r.ok) throw new Error(await errorText(r))
      return ((await r.json()) as { docs?: unknown[] }).docs ?? []
    }
    Promise.all([get(`/label-templates?where[collection][equals]=${encodeURIComponent(collection)}&limit=100&depth=0&sort=name`), get('/label-media?limit=100&depth=0')])
      .then(([t, m]) => {
        if (!live) return
        setTemplates(t as TemplateRow[])
        setStored(m as MediaRow[])
        setTemplate((cur) => cur || String((t[0] as TemplateRow | undefined)?.key ?? ''))
      })
      .catch((e: unknown) => live && setLoadError(e instanceof Error && e.message ? e.message : 'The templates could not be loaded.'))
    return () => {
      live = false
    }
  }, [open, apiRoute, collection])

  // Focus moves into the dialog on open.
  useEffect(() => {
    if (open) box.current?.querySelector<HTMLElement>('select, input, button')?.focus()
  }, [open])
  // Focus cannot leave the dialog while it is open: a click on the backdrop or a control that stops working puts it back.
  useEffect(() => {
    if (!open) return
    const back = (e: FocusEvent) => {
      const b = box.current
      if (b && e.target instanceof Node && !b.contains(e.target)) b.querySelector<HTMLElement>('select, input, button:not([aria-disabled="true"])')?.focus()
    }
    document.addEventListener('focusin', back)
    return () => document.removeEventListener('focusin', back)
  }, [open])
  useEffect(
    () => () => {
      if (result) URL.revokeObjectURL(result.url)
    },
    [result],
  )

  const tpl = templates.find((t) => t.key === template)
  const options = useMemo(() => [...Object.values(MEDIA_PRESETS).map((m) => ({ value: m.key, label: m.name })), ...stored.map((m) => ({ value: m.key || String(m.id), label: m.name || m.key || String(m.id) }))], [stored])
  /** The media the print will use, so the slot picker matches it. */
  const media: LabelMedia | undefined = useMemo(() => {
    const preset = mediaChoice ? MEDIA_PRESETS[mediaChoice] : undefined
    if (preset) return preset
    const row = mediaChoice ? stored.find((m) => (m.key || String(m.id)) === mediaChoice) : stored.find((m) => String(m.id) === String(tpl?.media && typeof tpl.media === 'object' ? (tpl.media as { id?: unknown }).id : tpl?.media))
    if (!row) return mediaChoice ? undefined : THERMAL_4X6
    const parsed = parseMedia(row.kind, row.key || String(row.id), row.name ?? '', row.definition)
    return typeof parsed === 'string' ? undefined : parsed
  }, [mediaChoice, stored, tpl])
  const sheet = media?.kind === 'sheet' ? media : undefined
  const per = sheet ? sheet.columns * sheet.rows : 0
  const slot = Math.min(Math.max(start, 1), per || 1)
  const where = sheet ? `Slot ${slot}, row ${Math.ceil(slot / sheet.columns)}, column ${((slot - 1) % sheet.columns) + 1}` : ''

  const pick = (n: number, focus = true) => {
    if (!sheet) return
    const next = Math.min(Math.max(n, 1), per)
    setStart(next)
    if (focus) slots.current[next - 1]?.focus()
  }
  const onSlotKey = (e: KeyboardEvent, n: number) => {
    if (!sheet) return
    const move: Record<string, number> = { ArrowRight: n + 1, ArrowLeft: n - 1, ArrowDown: n + sheet.columns, ArrowUp: n - sheet.columns, Home: 1, End: per }
    if (e.key in move) {
      e.preventDefault()
      pick(move[e.key]!)
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      pick(n, false)
    }
  }

  const onDialogKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close()
    } else if (e.key === 'Tab' && box.current) {
      const f = [...box.current.querySelectorAll<HTMLElement>('select, input, button, a[href], [tabindex="0"]')].filter((el) => !el.hasAttribute('disabled') && el.getAttribute('tabindex') !== '-1')
      const first = f[0]
      const last = f.at(-1)
      if (!first || !last) return
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  const print = async () => {
    if (busy) return
    setError('')
    setResult(null)
    const n = Number(copies)
    if (!ids.length) return setError('Select at least one document first.')
    if (!template) return setError('Pick a template.')
    if (!Number.isInteger(n) || n < 1) return setError('Copies must be a whole number of 1 or more.')
    setBusy(true)
    try {
      const r = await fetch(`${apiRoute}/labels/print`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template, ids, copies: n, ...(mediaChoice ? { media: mediaChoice } : {}), ...(sheet ? { start: slot } : {}) }),
      })
      if (!r.ok) return setError(await errorText(r))
      const url = URL.createObjectURL(await r.blob())
      setResult({ url, text: `Your labels are ready (${ids.length * n} ${ids.length * n === 1 ? 'label' : 'labels'}).` })
    } catch {
      setError('The server could not be reached. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <style>{CSS}</style>
      <button className="labels-open" type="button" ref={opener} onClick={() => setOpen(true)} aria-haspopup="dialog">
        Print labels
      </button>
      {open && (
        <div className="labels-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && e.preventDefault()}>
          <div className="labels-dialog" role="dialog" aria-modal="true" aria-labelledby={`${uid}-h`} ref={box} onKeyDown={onDialogKey}>
            <h2 id={`${uid}-h`} style={{ margin: 0 }}>
              Print labels
            </h2>
            <p style={{ margin: 0 }}>
              {ids.length ? `${ids.length} ${ids.length === 1 ? 'document' : 'documents'} selected.` : 'No documents are selected. Select at least one first.'} Print at 100% (Actual size), because browsers shrink pages by default.
            </p>
            {loadError && (
              <p className="labels-error" role="alert">
                {loadError}
              </p>
            )}
            <div>
              <label htmlFor={`${uid}-t`}>Template</label>
              <select id={`${uid}-t`} value={template} onChange={(e) => setTemplate(e.target.value)}>
                {!templates.length && <option value="">No templates for this collection</option>}
                {templates.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name || t.key}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${uid}-m`}>Media</label>
              <select id={`${uid}-m`} value={mediaChoice} onChange={(e) => setMediaChoice(e.target.value)}>
                <option value="">Template&apos;s own media (default)</option>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            {sheet && (
              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend id={`${uid}-s`}>Start slot</legend>
                <p style={{ margin: '0 0 .4rem' }} id={`${uid}-hint`}>
                  Choose the first free slot on the sheet. Use the arrow keys to move.
                </p>
                <div className="labels-slots" role="radiogroup" aria-labelledby={`${uid}-s`} aria-describedby={`${uid}-hint`} style={{ gridTemplateColumns: `repeat(${sheet.columns}, minmax(2.25rem, 1fr))` }}>
                  {Array.from({ length: per }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      ref={(el) => {
                        slots.current[n - 1] = el
                      }}
                      type="button"
                      role="radio"
                      className="labels-slot"
                      aria-checked={n === slot}
                      aria-label={`Slot ${n}, row ${Math.ceil(n / sheet.columns)}, column ${((n - 1) % sheet.columns) + 1}`}
                      tabIndex={n === slot ? 0 : -1}
                      onClick={() => pick(n, false)}
                      onKeyDown={(e) => onSlotKey(e, n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            <p role="status" style={{ margin: 0 }}>
              {sheet ? `Starting at ${where}.` : ''}
            </p>
            <div>
              <label htmlFor={`${uid}-c`}>Copies of each label</label>
              <input id={`${uid}-c`} type="number" min={1} step={1} value={copies} onChange={(e) => setCopies(e.target.value)} />
            </div>
            {error && (
              <p className="labels-error" role="alert">
                {error}
              </p>
            )}
            <p role="status" style={{ margin: 0 }}>
              {result && (
                <>
                  {result.text}{' '}
                  <a className="labels-link" href={result.url} target="_blank" rel="noreferrer">
                    Open the PDF
                  </a>{' '}
                  <a className="labels-link" href={result.url} download="labels.pdf">
                    Download the PDF
                  </a>
                </>
              )}
            </p>
            <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
              <button type="button" onClick={close}>
                Close
              </button>
              <button type="button" onClick={print} aria-disabled={busy} aria-busy={busy}>
                {busy ? 'Printing...' : 'Print'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
