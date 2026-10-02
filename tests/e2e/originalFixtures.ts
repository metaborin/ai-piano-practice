import type { Page } from '@playwright/test'

/** Two synthetic reference pages; no copyrighted score or user document. */
export function referencePdf(): Buffer {
  const pages = [1, 2].map(index => `BT /F1 24 Tf 40 740 Td (Reference score - page ${index}) Tj ET\n0 0 0 RG\n` +
    [0, 1, 2, 3, 4].map(line => `40 ${650 - line * 12} m 550 ${650 - line * 12} l S`).join('\n') +
    `\nBT /F1 20 Tf 40 560 Td (Teacher notes / fingering ${index}) Tj ET`)
  const objects = [
    '<</Type /Catalog /Pages 2 0 R>>', '<</Type /Pages /Kids [3 0 R 4 0 R] /Count 2>>',
    ...[5, 6].map(content => `<</Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources <</Font <</F1 7 0 R>>>> /Contents ${content} 0 R>>`),
    ...pages.map(content => `<</Length ${Buffer.byteLength(content)}>>\nstream\n${content}\nendstream`),
    '<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  return Buffer.from(pdf + `trailer\n<</Size ${objects.length + 1} /Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`)
}

export async function referenceImage(page: Page, mime: string) {
  const bytes = await page.evaluate(mime => {
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 2400
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 800, 2400)
    ctx.fillStyle = '#245184'; ctx.font = '30px sans-serif'; ctx.fillText('Reference / teacher notes', 30, 80)
    for (let row = 0; row < 8; row++) for (let line = 0; line < 5; line++) ctx.fillRect(30, 160 + row * 280 + line * 12, 740, 2)
    return Array.from(Uint8Array.from(atob(canvas.toDataURL(mime).split(',')[1]), c => c.charCodeAt(0)))
  }, mime)
  return Buffer.from(bytes)
}
