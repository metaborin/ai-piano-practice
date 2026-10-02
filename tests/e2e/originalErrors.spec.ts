import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { fixture, parseFixture } from '../unit/xmlFixture'
import { createPracticePlan } from '../../src/practice/PracticePlan'
import { buildDemoPlan } from '../../src/audio/buildDemoPlan'
import { referenceImage, referencePdf } from './originalFixtures'
import { mockMidi } from './midiFixture'

test.setTimeout(60_000)

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const form = (page: Page) => page.getByRole('form', { name: '元の楽譜の登録・削除確認' })
async function setup(page: Page) {
  await mockMidi(page); await page.goto('./'); await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await page.locator('.song-import input').setInputFiles({ name: 'mayim.xml', mimeType: 'application/xml', buffer: Buffer.from(fixture('maim-maim-full-original')) })
  await page.getByRole('form', { name: '曲の登録確認' }).getByRole('button', { name: '追加する', exact: true }).click()
  await button(page, '選択').click(); await expect(page.locator('.current-measure')).toHaveText('1小節目')
  await button(page, 'MIDI接続').click()
}
async function upload(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.locator('.original-score-editor input').setInputFiles({ name, mimeType, buffer })
}
async function attach(page: Page, name = 'test.pdf', mime = 'application/pdf', buffer = referencePdf()) {
  await upload(page, name, mime, buffer); await form(page).getByRole('button', { name: /^(登録する|置き換える)$/ }).click(); await expect(form(page)).toHaveCount(0)
}
async function database(page: Page) {
  return page.evaluate(() => new Promise<{ songs: unknown[]; assets: { id: string; size: number; type: string }[] }>((resolve, reject) => {
    const request = indexedDB.open('ai-piano-practice')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(['songs', 'originalScores']), songs = tx.objectStore('songs').getAll(), assets = tx.objectStore('originalScores').getAll()
      tx.oncomplete = () => { db.close(); resolve({ songs: songs.result, assets: assets.result.map(({ id, blob }) => ({ id, size: blob.size, type: blob.type })) }) }
    }
  }))
}

test('version 1 migration preserves exact old Mayim records and only adds a Blob store', async ({ page }) => {
  await page.route('**/migration-bootstrap', route => route.fulfill({ contentType: 'text/html', body: '<html><body>test origin</body></html>' }))
  await page.goto('./migration-bootstrap')
  const old = { id: 'imported:legacy', title: '保存済みマイム', source: 'imported', partLabel: 'SECONDO', originalFileName: 'old.xml', fileFormat: 'musicxml', createdAt: 123,
    musicXml: { type: 'text', value: fixture('maim-maim-full-original') }, compatibility: { status: 'supported', version: 3, reasons: [] } }
  await page.evaluate(song => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('ai-piano-practice', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('songs', { keyPath: 'id' })
    request.onerror = () => reject(request.error)
    request.onsuccess = () => { const db = request.result, tx = db.transaction('songs', 'readwrite'); tx.objectStore('songs').add(song); tx.oncomplete = () => { db.close(); resolve() } }
  }), old)
  await page.goto('./'); await expect(page.locator('.personal-song-list')).toContainText('保存済みマイム')
  expect((await database(page)).songs).toEqual([old]); expect((await database(page)).assets).toEqual([])
  await button(page, '選択').click(); await expect(page.locator('.current-measure')).toHaveText('1小節目')
  await attach(page); expect((await database(page)).assets).toHaveLength(1)
})

test('rejects unsupported, mismatched, renamed and oversized reference files without modifying the Song', async ({ page }) => {
  await setup(page); const before = await database(page)
  for (const [name, type, buffer, message] of [
    ['bad.svg', 'image/svg+xml', Buffer.from('<svg/>'), 'PDFまたは画像'],
    ['bad.png', 'application/pdf', referencePdf(), 'PDFまたは画像'],
    ['renamed.pdf', 'application/pdf', Buffer.from('not a PDF'), '内容'],
  ] as const) {
    await upload(page, name, type, buffer); await expect(page.locator('.original-score-editor [role=alert]')).toContainText(message)
  }
  await page.locator('.original-score-editor input').evaluate((input: HTMLInputElement) => {
    const file = new File(['%PDF-1.4'], 'large.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'size', { value: 30 * 1024 * 1024 + 1 })
    const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await expect(page.locator('.original-score-editor [role=alert]')).toContainText('30 MB')
  await expect(form(page)).toHaveCount(0); expect(await database(page)).toEqual(before)
  await expect(button(page, '練習開始')).toBeEnabled()
})

test('failed replacement transaction rolls back metadata and both Blob writes/deletes, then retry succeeds', async ({ page }) => {
  await setup(page); await attach(page); const before = await database(page)
  await upload(page, 'next.png', 'image/png', await referenceImage(page, 'image/png'))
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      const result = put.apply(this, args)
      if (this.name === 'originalScores') { IDBObjectStore.prototype.put = put; result.addEventListener('success', () => this.transaction.abort()) }
      return result
    }
  })
  await button(page, '置き換える').click(); await expect(page.locator('.original-score-editor [role=alert]')).toContainText('保存・削除できませんでした')
  expect(await database(page)).toEqual(before)
  await button(page, '置き換える').click(); await expect(form(page)).toHaveCount(0)
  expect((await database(page)).assets).toHaveLength(1)
  expect((await database(page)).assets[0].id).not.toBe(before.assets[0].id)
})

for (const kind of ['missing Blob', 'broken PDF', 'broken image', 'URL failure', 'PDF module failure']) test(kind + ' is isolated from practice, and another reference can recover', async ({ page }) => {
  await setup(page)
  if (kind === 'broken PDF') await attach(page, 'broken.pdf', 'application/pdf', Buffer.from('%PDF-1.7\nnot a valid document'))
  else if (kind === 'broken image') await attach(page, 'broken.jpg', 'image/jpeg', Buffer.from([255, 216, 255, 0, 0]))
  else if (kind === 'URL failure') {
    await attach(page, 'image.png', 'image/png', await referenceImage(page, 'image/png'))
    await page.evaluate(() => {
      const create = URL.createObjectURL
      URL.createObjectURL = function (blob) { if (blob instanceof Blob && blob.type === 'image/png') { URL.createObjectURL = create; throw new Error('元の楽譜の表示URLを作成できませんでした。') } return create.call(this, blob) }
    })
  } else await attach(page)
  if (kind === 'missing Blob') await page.evaluate(() => new Promise<void>(resolve => {
    const request = indexedDB.open('ai-piano-practice'); request.onsuccess = () => { const db = request.result, tx = db.transaction('originalScores', 'readwrite'); tx.objectStore('originalScores').clear(); tx.oncomplete = () => { db.close(); resolve() } }
  }))
  if (kind === 'PDF module failure') await page.route('**/*PdfScoreView*', route => route.abort())
  const position = await page.locator('.position').innerText()
  await button(page, '練習開始').click(); await button(page, '元の楽譜').click()
  await expect(page.locator('.original-score-view [role=alert]')).toBeVisible()
  await expect(page.locator('.position')).toHaveText(position)
  await button(page, '練習用楽譜').click(); await expect(page.locator('.score-renderer svg')).toBeVisible()
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status', 'practicing')
  await attach(page, 'recovery.png', 'image/png', await referenceImage(page, 'image/png'))
  await button(page, '元の楽譜').click()
  await expect.poll(() => page.locator('.original-score-image').evaluate((img: HTMLImageElement) => img.naturalHeight)).toBe(2400)
})

test('a real PDF can open while demo keeps running, with no output clear, CC123 or duplicate MIDI listeners', async ({ page }) => {
  await setup(page); await attach(page)
  const outgoing: string[] = []; page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) outgoing.push(request.url()) })
  await button(page, '手本を聴く').click()
  const baseline = await page.evaluate(() => ({ clears: window.midiTest.outputClears.length, cc123: window.midiTest.outputMessages.filter(m => m.data[0] === 0xb0 && m.data[1] === 123).length }))
  await button(page, '元の楽譜').click(); await expect(page.locator('.original-pdf canvas').first()).toHaveAttribute('data-rendered', 'true')
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'playing')
  await button(page, '練習用楽譜').click()
  expect(await page.evaluate(() => ({ clears: window.midiTest.outputClears.length, cc123: window.midiTest.outputMessages.filter(m => m.data[0] === 0xb0 && m.data[1] === 123).length }))).toEqual(baseline)
  expect(await page.evaluate(() => window.midiTest.inputListenerCount())).toBe(1)
  const sent = await page.evaluate(() => window.midiTest.outputMessages.filter(m => m.data[0] === 0x90).map(m => m.data[1]))
  const expected = buildDemoPlan(createPracticePlan(parseFixture('maim-maim-full-original'), 'both')!).map(n => n.midiNote)
  expect(sent).toEqual(expected.slice(0, sent.length))
  expect(outgoing).toEqual([])
})

test('PDF fonts, Japanese CMaps and scan codecs are served below the repository base', async ({ request }) => {
  for (const file of ['cmaps/78-EUC-H.bcmap', 'standard_fonts/FoxitDingbats.pfb', 'wasm/openjpeg.wasm']) {
    const response = await request.get('pdfjs/' + file)
    expect(response.ok()).toBe(true)
    const bytes = await response.body()
    expect(bytes.length).toBeGreaterThan(100)
    expect(bytes.subarray(0, 30).toString()).not.toContain('<!doctype html')
    if (file.endsWith('.wasm')) expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0, 97, 115, 109]))
  }
})
