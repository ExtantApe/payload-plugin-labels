// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PrintLabelsDialog } from '../src/client/PrintLabelsDialog.js'

const sheetDef = { page: { width: 215.9, height: 279.4 }, columns: 2, rows: 2, width: 90, height: 50, top: 10, left: 10, pitchX: 100, pitchY: 60 }
const templates = [{ id: 't1', key: 'box', name: 'Box label' }, { id: 't2', key: 'small', name: 'Small label', media: 'm1' }]
const media = [{ id: 'm1', key: 'my-sheet', name: 'My sheet', kind: 'sheet', definition: sheetDef }]
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let calls: Array<{ url: string; init?: RequestInit }>
let printReply: () => Response
beforeEach(() => {
  calls = []
  printReply = () => new Response('%PDF-fake', { status: 200 })
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    if (url.includes('/label-templates')) return json({ docs: templates })
    if (url.includes('/label-media')) return json({ docs: media })
    return printReply()
  })
  URL.createObjectURL = () => 'blob:fake'
  URL.revokeObjectURL = () => {}
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const openIt = async () => {
  render(<PrintLabelsDialog collection="orders" ids={['a1', 'a2']} />)
  const button = screen.getByRole('button', { name: 'Print labels' })
  button.focus()
  fireEvent.click(button)
  await screen.findByRole('dialog', { name: 'Print labels' })
  await waitFor(() => expect(screen.getByLabelText('Template')).toHaveProperty('value', 'box'))
  return button
}
const body = () => JSON.parse(String(calls.find((c) => c.url.endsWith('/labels/print'))!.init!.body))

describe('print dialog', () => {
  it('opens as a modal dialog with focus inside, closes on Escape and returns focus', async () => {
    const button = await openIt()
    const dlg = screen.getByRole('dialog')
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    expect(dlg.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(dlg, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(button)
  })
  it('keeps Tab inside the dialog and closes with the Close button, returning focus', async () => {
    const button = await openIt()
    const dlg = screen.getByRole('dialog')
    const print = screen.getByRole('button', { name: 'Print' })
    print.focus()
    fireEvent.keyDown(print, { key: 'Tab' })
    expect(dlg.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(screen.getByLabelText('Template'))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(document.activeElement).toBe(button))
  })
  it('lists the collection templates, asks only for that collection and sends the right body', async () => {
    await openIt()
    expect(calls[0]!.url).toContain('where[collection][equals]=orders')
    fireEvent.change(screen.getByLabelText('Copies of each label'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Print' }))
    await screen.findByText(/Your labels are ready \(6 labels\)/)
    expect(body()).toEqual({ template: 'box', ids: ['a1', 'a2'], copies: 3 })
    expect(screen.getByRole('link', { name: 'Download the PDF' }).getAttribute('href')).toBe('blob:fake')
  })
  it('shows a slot grid for sheet media, operable by keyboard, and sends the start slot', async () => {
    await openIt()
    expect(screen.queryByRole('radiogroup')).toBeNull()
    fireEvent.change(screen.getByLabelText('Media'), { target: { value: 'avery-5160' } })
    const first = await screen.findByRole('radio', { name: 'Slot 1, row 1, column 1' })
    expect(screen.getAllByRole('radio')).toHaveLength(30)
    expect(first.getAttribute('aria-checked')).toBe('true')
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    const four = screen.getByRole('radio', { name: 'Slot 4, row 2, column 1' })
    expect(document.activeElement).toBe(four)
    fireEvent.keyDown(four, { key: 'ArrowRight' })
    const five = screen.getByRole('radio', { name: 'Slot 5, row 2, column 2' })
    fireEvent.keyDown(five, { key: ' ' })
    expect(five.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('status').textContent).toContain('Slot 5, row 2, column 2')
    fireEvent.click(screen.getByRole('button', { name: 'Print' }))
    await screen.findByText(/ready/)
    expect(body()).toEqual({ template: 'box', ids: ['a1', 'a2'], copies: 1, media: 'avery-5160', start: 5 })
  })
  it("defaults to the template's own media: a sheet shows its grid and sends no media key", async () => {
    await openIt()
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'small' } })
    expect(await screen.findAllByRole('radio')).toHaveLength(4)
    fireEvent.click(screen.getByRole('button', { name: 'Print' }))
    await screen.findByText(/ready/)
    expect(body()).toEqual({ template: 'small', ids: ['a1', 'a2'], copies: 1, start: 1 })
  })
  it("shows the endpoint's message in plain words, and prints nothing", async () => {
    printReply = () => json({ message: 'One or more of those documents does not exist or you may not read them. Nothing was printed.' }, 403)
    await openIt()
    fireEvent.click(screen.getByRole('button', { name: 'Print' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Nothing was printed')
    expect(screen.queryByText(/ready/)).toBeNull()
  })
  it('refuses bad copies in the dialog before calling the server', async () => {
    await openIt()
    fireEvent.change(screen.getByLabelText('Copies of each label'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Print' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/whole number/)
    expect(calls.some((c) => c.url.endsWith('/labels/print'))).toBe(false)
  })
})
