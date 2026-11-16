import PDFDocument from 'pdfkit'

import { MM_PER_POINT, barcodePlacement, barcodeVector, type LayoutResult, type Mark } from './core/index.js'

const pt = (mm: number) => mm / MM_PER_POINT

function drawMark(doc: PDFKit.PDFDocument, m: Mark): void {
  doc.save()
  if (m.rotation) doc.rotate(m.rotation, { origin: [pt(m.x + m.width / 2), pt(m.y + m.height / 2)] })
  switch (m.type) {
    case 'text': {
      const font = `Helvetica${m.bold || m.italic ? '-' : ''}${m.bold ? 'Bold' : ''}${m.italic ? 'Oblique' : ''}`
      doc.font(font).fontSize(m.fontSize).fillColor(m.missing ? '#c2410c' : '#000')
      m.lines.forEach((line, i) => doc.text(line, pt(m.x), pt(m.y) + i * m.fontSize * 1.2, { width: pt(m.width), align: m.align, lineBreak: false }))
      break
    }
    case 'barcode': {
      const v = barcodeVector(m.symbology, m.value)
      if (!v) {
        doc.dash(2, { space: 2 }).lineWidth(0.7).strokeColor('#c2410c').rect(pt(m.x), pt(m.y), pt(m.width), pt(m.height)).stroke()
        break
      }
      const p = barcodePlacement(m, v)
      doc.save().translate(pt(p.tx), pt(p.ty)).scale(pt(p.sx), pt(p.sy))
      for (const q of v.paths) {
        if (q.stroke) doc.path(q.d).lineWidth(q.stroke).strokeColor('#000').stroke()
        else doc.path(q.d).fillColor('#000').fill()
      }
      doc.restore()
      if (p.text) doc.font('Helvetica').fontSize(p.text.size).fillColor('#000').text(m.value, pt(p.text.x), pt(p.text.y), { width: pt(p.text.width), align: 'center', lineBreak: false })
      break
    }
    case 'image':
      doc.lineWidth(0.6).strokeColor('#999').rect(pt(m.x), pt(m.y), pt(m.width), pt(m.height)).stroke()
      break
    case 'line':
      doc.lineWidth(pt(m.thickness)).strokeColor('#000').moveTo(pt(m.x), pt(m.y)).lineTo(pt(m.x + m.width), pt(m.y + m.height)).stroke()
      break
    case 'box':
      doc.lineWidth(pt(m.thickness)).strokeColor('#000').rect(pt(m.x), pt(m.y), pt(m.width), pt(m.height)).stroke()
      break
  }
  doc.restore()
}

/** One page per label, each page the label's size, drawn from the same marks as the SVG preview. */
export function renderPdf(labels: LayoutResult[]): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false, margin: 0, info: { Title: 'Labels' } })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))))
    doc.on('error', reject)
    for (const l of labels) {
      doc.addPage({ size: [pt(l.width), pt(l.height)], margin: 0 })
      for (const m of l.marks) drawMark(doc, m)
    }
    doc.end()
  })
}
