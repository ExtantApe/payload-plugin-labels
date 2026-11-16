// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { TemplateEditor } from '../src/client/TemplateEditor.js'
import type { LabelElement } from '../src/core/index.js'

afterEach(cleanup)

const start: LabelElement[] = [
  { type: 'text', x: 5, y: 5, width: 80, height: 10, fontSize: 14, content: '{{name}}' },
  { type: 'barcode', x: 5, y: 20, width: 60, height: 20, symbology: 'code128', value: '{{code}}' },
  { type: 'text', x: 5, y: 45, width: 80, height: 8, fontSize: 10, content: '{{nothing}}' },
]
let latest: LabelElement[] = start

function Harness({ sample }: { sample?: string }) {
  const [els, setEls] = useState(start)
  latest = els
  return <TemplateEditor elements={els} onChange={setEls} size={{ width: 101.6, height: 152.4 }} sample={sample} />
}
const layers = () => screen.getByRole('listbox', { name: 'Layers' })
const options = () => within(layers()).getAllByRole('option')
const preview = () => screen.getByRole('img', { name: /Label preview/ })

describe('TemplateEditor', () => {
  it('draws the preview at the label size and updates it when the sample record changes', () => {
    render(<Harness sample='{"name":"Example item","code":"ABC-123"}' />)
    expect(preview().innerHTML).toContain('viewBox="0 0 101.6 152.4"')
    expect(preview().textContent).toContain('Example item')
    fireEvent.change(screen.getByLabelText('Sample record (JSON)'), { target: { value: '{"name":"Another","code":"Z9"}' } })
    expect(preview().textContent).toContain('Another')
    expect(preview().textContent).not.toContain('Example item')
  })
  it('updates the preview when an inspector field changes, and writes it back to the elements', () => {
    render(<Harness sample='{"name":"Example item","code":"ABC-123"}' />)
    fireEvent.change(screen.getByLabelText('Text, with {{field}} tokens'), { target: { value: 'Hello {{name}}' } })
    expect(latest[0]).toMatchObject({ type: 'text', content: 'Hello {{name}}' })
    expect(preview().textContent).toContain('Hello Example item')
    fireEvent.change(screen.getByLabelText('X position (mm)'), { target: { value: '12.5' } })
    fireEvent.change(screen.getByLabelText('Font size (pt)'), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText('When the text does not fit'), { target: { value: 'ellipsis' } })
    expect(latest[0]).toMatchObject({ x: 12.5, fontSize: 20, overflow: 'ellipsis' })
  })
  it('edits the barcode type and value of a selected barcode layer', () => {
    render(<Harness sample='{"code":"ABC-123"}' />)
    fireEvent.click(options()[1]!)
    fireEvent.change(screen.getByLabelText('Barcode type'), { target: { value: 'code39' } })
    fireEvent.change(screen.getByLabelText('Value, with {{field}} tokens'), { target: { value: '{{code}}-X' } })
    expect(latest[1]).toMatchObject({ symbology: 'code39', value: '{{code}}-X' })
  })
  it('moves the layer selection with the arrow keys', () => {
    render(<Harness />)
    expect(options()[0]!.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(layers(), { key: 'ArrowDown' })
    expect(options()[1]!.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(layers(), { key: 'End' })
    expect(options()[2]!.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(layers(), { key: 'ArrowDown' })
    expect(options()[2]!.getAttribute('aria-selected')).toBe('true')
  })
  it('reorders a layer with the buttons, follows it, and announces the result', () => {
    render(<Harness />)
    fireEvent.keyDown(layers(), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('button', { name: 'Move layer up' }))
    expect(latest.map((e) => e.type)).toEqual(['barcode', 'text', 'text'])
    expect(options()[0]!.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('status').textContent).toBe('Moved barcode to position 1 of 3.')
    fireEvent.click(screen.getByRole('button', { name: 'Move layer up' }))
    expect(screen.getByRole('status').textContent).toContain('already first')
  })
  it('hides a layer from the preview without deleting it, and deletes on request', () => {
    render(<Harness sample='{"name":"Example item"}' />)
    fireEvent.click(screen.getByRole('button', { name: 'Hide layer' }))
    expect(preview().textContent).not.toContain('Example item')
    expect(latest).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Show layer' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete layer' }))
    expect(latest).toHaveLength(2)
  })
  it('adds a layer from the type list', () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('Add a layer'), { target: { value: 'qr' } })
    expect(latest.at(-1)?.type).toBe('qr')
    expect(options()).toHaveLength(4)
  })
  it('lists layout warnings against the right layer, even with a layer hidden', () => {
    render(<Harness sample='{"name":"Example item","code":"ABC-123"}' />)
    const list = screen.getByRole('list', { name: 'Warnings' })
    expect(within(list).getByText(/Layer 3: No value for \{\{nothing\}\}/)).toBeTruthy()
    fireEvent.click(options()[0]!)
    fireEvent.click(screen.getByRole('button', { name: 'Hide layer' }))
    expect(within(screen.getByRole('list', { name: 'Warnings' })).getByText(/Layer 3:/)).toBeTruthy()
  })
  it('treats non-string content stored before validation as empty', () => {
    const old = [{ type: 'text', x: 5, y: 5, width: 80, height: 10, fontSize: 14, content: 42 }] as unknown as LabelElement[]
    render(<TemplateEditor elements={old} onChange={() => {}} size={{ width: 101.6, height: 152.4 }} />)
    expect(preview().innerHTML).toContain('<svg')
    expect(options()[0]!.textContent).toContain('1. text')
  })

  it('says so when the sample is not valid JSON, and keeps working', () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('Sample record (JSON)'), { target: { value: '{oops' } })
    expect(screen.getByRole('alert').textContent).toContain('not valid JSON')
    expect(preview().innerHTML).toContain('<svg')
  })
  it('labels every form control', () => {
    render(<Harness />)
    for (const c of screen.getAllByRole('textbox').concat(screen.getAllByRole('spinbutton'), screen.getAllByRole('combobox'))) {
      expect(c.closest('label') ?? c.getAttribute('aria-label')).toBeTruthy()
    }
  })
})
