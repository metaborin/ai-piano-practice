import { readFileSync } from 'node:fs'
import { chromium, expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import JSZip from 'jszip'
import { mockMidi } from './midiFixture'

const original = readFileSync(new URL('../../src/scores/short-melody.musicxml', import.meta.url), 'utf8')
const xml = original.replace(/<work>.*?<\/work>/s, '<work><work-title>追加テスト</work-title></work>')
  .replace('<part-list>', '<identification><creator type="composer">テスト作曲者</creator></identification><part-list>')
const container = (path = 'scores/main.musicxml') => `<?xml version="1.0"?><container><rootfiles><rootfile full-path="${path}" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`
async function mxl(entries: Record<string, string>) {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(entries)) zip.file(name, content)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
async function setup(page: Page) {
  await mockMidi(page)
  await page.goto('./')
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
}
async function upload(page: Page, name = 'test.musicxml', content: string | Buffer = xml) {
  await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.isBuffer(content) ? content : Buffer.from(content) })
}
const form = (page: Page) => page.getByRole('form', { name: '曲の登録確認' })
const cards = (page: Page) => page.locator('.personal-song-list > li')
async function save(page: Page, name = 'test.musicxml', content: string | Buffer = xml) {
  await upload(page, name, content)
  await expect(form(page).getByRole('button', { name: '追加する', exact: true })).toBeEnabled()
  await form(page).getByRole('button', { name: '追加する', exact: true }).click()
  await expect(form(page)).toHaveCount(0)
}
async function records(page: Page) {
  return page.evaluate(() => new Promise<{ id: string; title: string; composer: string; musicXml: { value: string }; source: string; originalFileName: string; createdAt: number; fileFormat: string; compatibility: { status: string } }[]>((resolve, reject) => {
    const request = indexedDB.open('ai-piano-practice', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction('songs')
      const get = transaction.objectStore('songs').getAll()
      transaction.oncomplete = () => { db.close(); resolve(get.result) }
      transaction.onabort = () => { db.close(); reject(transaction.error) }
    }
  }))
}

for (const extension of ['musicxml', 'xml', 'mxl']) {
  test(extension + ': confirmation, metadata editing, exact XML persistence and common score/practice/demo pipeline', async ({ page }) => {
    await setup(page)
    const content = extension === 'mxl' ? await mxl({ 'META-INF/container.xml': container(), 'scores/main.musicxml': xml, 'wrong.xml': '<not-music/>' }) : xml
    await upload(page, 'example.' + extension, content)
    await expect(form(page).getByLabel('曲名', { exact: true })).toHaveValue('追加テスト')
    await expect(form(page).getByLabel('作曲者', { exact: true })).toHaveValue('テスト作曲者')
    await expect(form(page)).toContainText('この曲は現在の練習モードで使用できます')
    expect(await records(page)).toHaveLength(0)
    await form(page).getByLabel('曲名', { exact: true }).fill('自分のメロディ')
    await form(page).getByLabel('作曲者', { exact: true }).fill('私')
    await form(page).getByRole('button', { name: '追加する', exact: true }).click()
    await expect(cards(page)).toHaveCount(1)
    const [record] = await records(page)
    expect(record).toMatchObject({ title: '自分のメロディ', composer: '私', source: 'imported', originalFileName: 'example.' + extension, musicXml: { value: xml }, compatibility: { status: 'supported' } })
    expect(record.createdAt).toBeGreaterThan(0)
    expect(record.id).toMatch(/^imported:[0-9a-f-]{36}$/)
    await cards(page).getByRole('button', { name: '選択', exact: true }).click()
    await expect(page.locator('.position')).toHaveText('1 / 5 音')
    await expect(page.locator('.score-renderer .vf-stavenote')).toHaveCount(5)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('自分のメロディ')
    await page.getByRole('button', { name: 'MIDI接続', exact: true }).click()
    await page.getByRole('button', { name: '練習開始', exact: true }).click()
    await page.evaluate(() => { window.midiTest.send([0x90, 60, 80]); window.midiTest.send([0x80, 60, 0]) })
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', '0')
    for (const note of [67, 64, 65, 62, 67]) await page.evaluate((note) => { window.midiTest.send([0x90, note, 80]); window.midiTest.send([0x80, note, 0]) }, note)
    await expect(page.locator('.practice-feedback')).toHaveText('できました！')
    await page.clock.install()
    await page.getByRole('button', { name: '手本を聴く' }).click()
    await page.clock.runFor(4200)
    expect(await page.evaluate(() => window.midiTest.outputMessages.filter((event) => event.data[0] === 0x90).map((event) => event.data[1]))).toEqual([67, 64, 65, 62, 67])
    await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'completed')
  })
}

test('fallback title, movement-title, cancellation, same titles with distinct IDs and restoration after reload/new page', async ({ page, context }) => {
  await setup(page)
  const noMetadata = original.replace(/<work>.*?<\/work>/s, '')
  await upload(page, '自分の練習.XML', noMetadata)
  await expect(form(page).getByLabel('曲名', { exact: true })).toHaveValue('自分の練習')
  await expect(form(page).getByLabel('作曲者', { exact: true })).toHaveValue('')
  await form(page).getByRole('button', { name: 'キャンセル' }).click()
  expect(await records(page)).toHaveLength(0)
  const movement = noMetadata.replace('<part-list>', '<movement-title>同じ曲名</movement-title><part-list>')
  await save(page, 'same.xml', movement)
  await save(page, 'same.xml', movement)
  let saved = await records(page)
  expect(saved.map((song) => song.title)).toEqual(['同じ曲名', '同じ曲名'])
  expect(new Set(saved.map((song) => song.id)).size).toBe(2)
  await page.reload()
  await expect(cards(page)).toHaveCount(2)
  const url = page.url()
  await page.close()
  const reopened = await context.newPage()
  await reopened.goto(url)
  await expect(cards(reopened)).toHaveCount(2)
  saved = await records(reopened)
  expect(saved.every((song) => song.musicXml.value === movement)).toBe(true)
})

const invalidFiles = [
  { name: 'extension', file: 'score.pdf', content: () => Promise.resolve(xml), message: '対応していない拡張子' },
  { name: 'broken XML', file: 'score.xml', content: () => Promise.resolve('<score-partwise><bad>'), message: 'XMLが壊れています' },
  { name: 'non MusicXML', file: 'score.xml', content: () => Promise.resolve('<document/>'), message: 'MusicXMLではないXML' },
  { name: 'no part', file: 'score.xml', content: () => Promise.resolve('<score-partwise><measure/></score-partwise>'), message: 'partがありません' },
  { name: 'no measure', file: 'score.xml', content: () => Promise.resolve('<score-partwise><part/></score-partwise>'), message: 'measureがありません' },
  { name: 'broken ZIP', file: 'score.mxl', content: () => Promise.resolve('not zip'), message: 'ZIPファイルが壊れている' },
  { name: 'missing container', file: 'score.mxl', content: () => mxl({ 'guess.xml': xml }), message: 'container.xmlがありません' },
  { name: 'invalid container', file: 'score.mxl', content: () => mxl({ 'META-INF/container.xml': '<broken>' }), message: 'container.xmlが壊れています' },
  { name: 'missing rootfile', file: 'score.mxl', content: () => mxl({ 'META-INF/container.xml': '<container><rootfiles/></container>' }), message: 'rootfileのfull-pathがありません' },
  { name: 'missing body', file: 'score.mxl', content: () => mxl({ 'META-INF/container.xml': container(), 'guess.xml': xml }), message: 'MusicXML本体がありません' },
  { name: 'unsafe path', file: 'score.mxl', content: () => mxl({ 'META-INF/container.xml': container('../score.xml'), '../score.xml': xml }), message: 'rootfileパスが不正' },
  { name: 'first rootfile required', file: 'score.mxl', content: () => mxl({ 'META-INF/container.xml': '<container><rootfiles><rootfile full-path="missing.xml"/><rootfile full-path="found.xml"/></rootfiles></container>', 'found.xml': xml }), message: 'MusicXML本体がありません' },
  { name: 'oversized input', file: 'large.xml', content: () => Promise.resolve(Buffer.alloc(10 * 1024 * 1024 + 1, 32)), message: 'ファイルサイズが大きすぎます' },
  { name: 'oversized expanded XML', file: 'large.mxl', content: () => mxl({ 'META-INF/container.xml': container(), 'scores/main.musicxml': ' '.repeat(10 * 1024 * 1024 + 1) }), message: '展開後のファイルサイズが大きすぎます' },
  { name: 'oversized container', file: 'large.mxl', content: () => mxl({ 'META-INF/container.xml': ' '.repeat(65537) }), message: '展開後のファイルサイズが大きすぎます' },
]
for (const item of invalidFiles) test(item.name + ': rejects safely and keeps the previous score usable', async ({ page }) => {
  await setup(page)
  await upload(page, item.file, await item.content())
  await expect(page.getByRole('alert')).toContainText(item.message)
  await expect(form(page)).toHaveCount(0)
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  expect(await records(page)).toHaveLength(0)
  await save(page)
  await expect(cards(page)).toHaveCount(1)
})

const unsupported: [string, string][] = [
  ['和音', xml.replace('<note>', '<note><chord/>')],
  ['複数声部', xml.replace('<note>', '<note><voice>2</voice>')],
  ['複数Staff', xml.replace('<note>', '<note><staff>2</staff>')],
  ['複数パート', xml.replace('</score-partwise>', '<part id="P2"><measure number="1"><note><rest/><duration>4</duration></note></measure></part></score-partwise>')],
  ['休符', xml.replace('<pitch><step>G</step><octave>4</octave></pitch>', '<rest/>')],
  ['score-timewise形式', '<score-timewise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><measure number="1"><part id="P1"><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></part></measure></score-timewise>'],
  ['練習対象の音がありません', xml.replace(/<note>.*?<\/note>/g, '')],
  ['解析できませんでした', xml.replaceAll('<octave>4</octave>', '<octave>10</octave>')],
  ['画像・外部参照', xml.replace('<part-list>', '<credit><credit-image source="https://invalid.example/user.png"/></credit><part-list>')],
]
for (const [reason, content] of unsupported) test(reason + ': stores unchanged XML and gates practice/demo independently of parse support', async ({ page }) => {
  const parsedPending = ['複数声部', '複数Staff', '休符'].includes(reason)
  await setup(page)
  await upload(page, 'complex.xml', content)
  await expect(form(page)).toContainText(parsedPending ? '現在の練習モードで使用できます' : '現在の練習機能では未対応')
  if (!parsedPending) await expect(form(page)).toContainText(reason)
  await form(page).getByRole('button', { name: '追加する', exact: true }).click()
  await expect(cards(page)).toContainText(parsedPending ? '音程練習対応' : '現在の練習機能では未対応')
  expect((await records(page))[0].musicXml.value).toBe(content)
  await cards(page).getByRole('button', { name: '選択', exact: true }).click()
  if (parsedPending) {
    await expect(page.locator('.score-renderer svg')).toBeVisible()
    await expect(page.locator('.score-card').getByRole('alert')).toHaveCount(0)
    await page.getByRole('button', { name: 'MIDI接続', exact: true }).click()
    for (const name of ['練習開始', '手本を聴く']) await expect(page.getByRole('button', { name, exact: true })).toBeEnabled()
  } else await expect(page.locator('.score-card').getByRole('alert')).toContainText(reason)
  if (!parsedPending) {
    await expect(page.locator('.position')).toHaveText('— / — 音')
    for (const name of ['練習開始', '手本を聴く']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled()
  }
  await page.getByRole('combobox', { name: '練習する曲' }).selectOption('twinkle-opening')
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
})

test('delete confirmation, selected-demo stop, other-song deletion preserves practice, MIDI remains connected', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: 'MIDI接続', exact: true }).click()
  await page.evaluate(() => { window.midiTest.setConnected('other', true); window.midiTest.setOutputConnected('other-out', true) })
  await page.getByRole('combobox', { name: '入力機器' }).selectOption('other')
  await page.getByRole('combobox', { name: '出力機器' }).selectOption('other-out')
  await page.getByRole('button', { name: '練習開始', exact: true }).click()
  await page.evaluate(() => { window.midiTest.send([0x90, 60, 80], 'other'); window.midiTest.send([0x80, 60, 0], 'other') })
  await save(page)
  await expect(page.locator('.position')).toHaveText('2 / 14 音')
  await save(page)
  await cards(page).last().getByRole('button', { name: '削除', exact: true }).click()
  await expect(cards(page).last()).toContainText('この曲を削除しますか？')
  await cards(page).last().getByRole('button', { name: 'キャンセル' }).click()
  expect(await records(page)).toHaveLength(2)
  await cards(page).last().getByRole('button', { name: '削除', exact: true }).click()
  await cards(page).last().getByRole('button', { name: '削除する', exact: true }).click()
  await expect(cards(page)).toHaveCount(1)
  await expect(page.locator('.position')).toHaveText('2 / 14 音')
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status', 'practicing')
  await cards(page).getByRole('button', { name: '選択', exact: true }).click()
  await expect(page.locator('.position')).toHaveText('1 / 5 音')
  await page.clock.install()
  await page.getByRole('button', { name: '手本を聴く' }).click()
  await cards(page).getByRole('button', { name: '削除', exact: true }).click()
  await cards(page).getByRole('button', { name: '削除する', exact: true }).click()
  await expect(cards(page)).toHaveCount(0)
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  const sent = await page.evaluate(() => window.midiTest.outputMessages)
  expect(sent.slice(-2).map((event) => event.data)).toEqual([[0x80, 67, 0], [0xb0, 123, 0]])
  await page.clock.runFor(20000)
  expect(await page.evaluate(() => window.midiTest.outputMessages.length)).toBe(sent.length)
  await expect(page.getByRole('combobox', { name: '入力機器' })).toHaveValue('other')
  await expect(page.getByRole('combobox', { name: '出力機器' })).toHaveValue('other-out')
  expect(await page.evaluate(() => window.midiTest.requests)).toBe(1)
  expect(await page.evaluate(() => window.midiTest.inputListenerCount())).toBe(1)
  await expect(page.getByRole('button', { name: '削除', exact: true })).toHaveCount(0)
  await page.reload()
  await expect(cards(page)).toHaveCount(0)
  await expect(page.locator('optgroup[label="内蔵曲"] option')).toHaveCount(3)
})

test('IndexedDB unavailable keeps built-in songs usable; explicit save failure retains draft', async ({ page }) => {
  await page.addInitScript(() => { indexedDB.open = () => { throw new DOMException('Denied', 'SecurityError') } })
  await setup(page)
  await expect(page.getByRole('alert')).toContainText('内蔵曲は利用できます')
  await upload(page)
  await expect(form(page).getByRole('button', { name: '追加する', exact: true })).toBeEnabled()
  await form(page).getByRole('button', { name: '追加する', exact: true }).click()
  await expect(page.locator('.import-error')).toContainText('曲を保存できませんでした')
  await expect(form(page)).toBeVisible()
  await expect(cards(page)).toHaveCount(0)
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
})

test('transaction abort is not reported as a successful save and can be retried', async ({ page }) => {
  await setup(page)
  await upload(page)
  await expect(form(page).getByRole('button', { name: '追加する', exact: true })).toBeEnabled()
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add
    IDBObjectStore.prototype.add = function (...args) {
      IDBObjectStore.prototype.add = add
      const request = add.apply(this, args)
      request.addEventListener('success', () => this.transaction.abort())
      return request
    }
  })
  await form(page).getByRole('button', { name: '追加する', exact: true }).click()
  await expect(page.locator('.import-error')).toContainText('曲を保存できませんでした')
  expect(await records(page)).toHaveLength(0)
  await form(page).getByRole('button', { name: '追加する', exact: true }).click()
  await expect(cards(page)).toHaveCount(1)
})

test('compatibility is rechecked from XML and stale cached versions are not trusted', async ({ page }) => {
  await setup(page)
  await save(page)
  await page.evaluate(() => new Promise<void>((resolve) => {
    const open = indexedDB.open('ai-piano-practice', 1)
    open.onsuccess = () => {
      const db = open.result
      const transaction = db.transaction('songs', 'readwrite')
      const store = transaction.objectStore('songs')
      const get = store.getAll()
      get.onsuccess = () => {
        const song = get.result[0]
        song.compatibility = { status: 'supported', version: 0, reasons: [] }
        store.put(song)
        store.put({ ...song, id: 'imported:forged', musicXml: { type: 'text', value: song.musicXml.value.replace('<note>', '<note><chord/>') } })
      }
      transaction.oncomplete = () => { db.close(); resolve() }
    }
  }))
  await page.reload()
  await expect(cards(page)).toHaveCount(2)
  await expect(cards(page).filter({ hasText: '練習可能' })).toHaveCount(1)
  const forged = page.locator('[data-song-id="imported:forged"]')
  await expect(forged).toContainText('現在の練習機能では未対応')
  await forged.getByRole('button', { name: '選択', exact: true }).click()
  await expect(page.locator('.score-card').getByRole('alert')).toContainText('和音')
  await expect(page.getByRole('button', { name: '練習開始', exact: true })).toBeDisabled()
})

test('registration fits narrow touch screens, escapes metadata and never uploads user content', async ({ page }) => {
  await setup(page)
  const uploads: string[] = []
  page.on('request', (request) => { if (!['GET', 'HEAD'].includes(request.method())) uploads.push(request.url()) })
  await page.setViewportSize({ width: 390, height: 844 })
  await upload(page)
  await expect(form(page).getByRole('button', { name: '追加する', exact: true })).toBeEnabled()
  await form(page).getByLabel('曲名', { exact: true }).fill('<script>alert(1)</script>')
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await form(page).getByLabel('曲名', { exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(48)
  await page.screenshot({ path: 'test-results/phase2eb-import-mobile.png', fullPage: true })
  await form(page).getByRole('button', { name: '追加する', exact: true }).click()
  await expect(cards(page)).toContainText('<script>alert(1)</script>')
  expect(uploads).toEqual([])
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.screenshot({ path: 'test-results/phase2eb-library-desktop.png', fullPage: true })
})

test('persistent IndexedDB survives closing and relaunching the browser process', async ({ page }, testInfo) => {
  await page.goto('./')
  const url = page.url()
  const profile = testInfo.outputPath('persistent-profile')
  let context = await chromium.launchPersistentContext(profile, { headless: true })
  try {
    const first = context.pages()[0]
    await first.goto(url)
    await expect(first.locator('.position')).toHaveText('1 / 14 音')
    await save(first)
    const before = await records(first)
    await context.close()
    context = await chromium.launchPersistentContext(profile, { headless: true })
    const reopened = context.pages()[0]
    await reopened.goto(url)
    await expect(cards(reopened)).toHaveCount(1)
    expect(await records(reopened)).toEqual(before)
    await cards(reopened).getByRole('button', { name: '選択', exact: true }).click()
    await expect(reopened.locator('.position')).toHaveText('1 / 5 音')
  } finally { await context.close() }
})

test('late file reads cannot replace a newer confirmation or resurrect a cancelled import', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer
    File.prototype.arrayBuffer = async function () {
      if (this.name === 'slow.xml') await new Promise<void>((resolve) => { (window as unknown as { releaseFile: () => void }).releaseFile = resolve })
      return read.call(this)
    }
  })
  await upload(page, 'slow.xml')
  await expect(page.getByText('ファイルを読み込み中…', { exact: false })).toBeVisible()
  await upload(page, 'new.xml', xml.replace('追加テスト', '最後の曲'))
  await expect(form(page).getByLabel('曲名', { exact: true })).toHaveValue('最後の曲')
  await page.evaluate(() => (window as unknown as { releaseFile: () => void }).releaseFile())
  await expect(form(page).getByLabel('曲名', { exact: true })).toHaveValue('最後の曲')
  await form(page).getByRole('button', { name: 'キャンセル' }).click()
  await upload(page, 'slow.xml')
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click()
  await page.evaluate(() => (window as unknown as { releaseFile: () => void }).releaseFile())
  await expect(form(page)).toHaveCount(0)
  expect(await records(page)).toHaveLength(0)
})

test('failed deletion retains the saved record while safely stopping the selected song', async ({ page }) => {
  await setup(page)
  await save(page)
  await cards(page).getByRole('button', { name: '選択', exact: true }).click()
  await expect(page.locator('.position')).toHaveText('1 / 5 音')
  await page.evaluate(() => {
    const remove = IDBObjectStore.prototype.delete
    IDBObjectStore.prototype.delete = function (...args) {
      IDBObjectStore.prototype.delete = remove
      const request = remove.apply(this, args)
      request.addEventListener('success', () => this.transaction.abort())
      return request
    }
  })
  await cards(page).getByRole('button', { name: '削除', exact: true }).click()
  await cards(page).getByRole('button', { name: '削除する', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('曲を削除できませんでした')
  await expect(cards(page)).toHaveCount(1)
  expect(await records(page)).toHaveLength(1)
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await cards(page).getByRole('button', { name: '削除する', exact: true }).click()
  await expect(cards(page)).toHaveCount(0)
})
