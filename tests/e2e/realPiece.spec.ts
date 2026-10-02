import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import JSZip from 'jszip'
import type { ImportedSong } from '../../src/songs/Song'
import { mockMidi } from './midiFixture'

const xml = readFileSync(new URL('../fixtures/timeline/i-piece-validation.musicxml', import.meta.url), 'utf8')
const modes = [
  { label: '右手', targets: [[72, 76], [74], [76], [79], [74, 77], [79], [72, 76]], onsets: [0, 1, 2, 4, 6, 8, 12], measures: [5, 5, 5, 6, 6, 7, 8] },
  { label: '左手', targets: [[48, 55], [52, 55], [53, 57], [55], [48, 55]], onsets: [0, 4, 8, 10, 13], measures: [5, 6, 7, 7, 8] },
  { label: '両手', targets: [[48, 55, 72, 76], [74], [76], [52, 55, 79], [74, 77], [53, 57, 79], [55], [72, 76], [48, 55]], onsets: [0, 1, 2, 4, 6, 8, 10, 12, 13], measures: [5, 5, 5, 6, 6, 7, 7, 8, 8] },
]
const form = (page: Page) => page.getByRole('form', { name: '曲の登録確認' })
const cards = (page: Page) => page.locator('.personal-song-list > li')
async function setup(page: Page) {
  await mockMidi(page); await page.goto('./')
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await page.getByRole('button', { name: 'MIDI接続', exact: true }).click()
}
async function upload(page: Page, content = xml, compressed = false) {
  let buffer: Buffer = Buffer.from(content)
  if (compressed) {
    const zip = new JSZip()
    zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>')
    zip.file('score.xml', content)
    buffer = await zip.generateAsync({ type: 'nodebuffer' })
  }
  await page.locator('.song-import input[type=file]').setInputFiles({ name: 'validation.' + (compressed ? 'mxl' : 'musicxml'), mimeType: 'application/octet-stream', buffer })
  await expect(form(page).getByRole('button', { name: '追加する', exact: true })).toBeEnabled()
}
async function saveAndSelect(page: Page) {
  await form(page).getByRole('button', { name: '追加する', exact: true }).click()
  await cards(page).last().getByRole('button', { name: '選択', exact: true }).click()
}
async function records(page: Page) {
  return page.evaluate(() => new Promise<ImportedSong[]>((resolve) => {
    const request = indexedDB.open('ai-piano-practice')
    request.onsuccess = () => { const db = request.result, tx = db.transaction('songs'), read = tx.objectStore('songs').getAll(); tx.oncomplete = () => { db.close(); resolve(read.result) } }
  }))
}

for (const mode of modes) test(mode.label + ': four-bar score reports scope, practices by measure and plays at XML 116 BPM', async ({ page }) => {
  await setup(page); await upload(page, xml, mode.label === '左手')
  await form(page).getByText('楽譜解析結果を確認', { exact: true }).click()
  const preview = form(page).getByRole('region', { name: '楽譜検証レポート' })
  await expect(preview).toContainText('小節：5 – 8（4小節・XMLの番号）')
  await expect(preview).toContainText('116 BPM（MusicXML） ／ 1拍：517.24ms')
  await expect(preview).toContainText('Tie：あり（2音符）')
  await expect(preview).toContainText('音程練習対応')
  await saveAndSelect(page)
  expect((await records(page))[0]).toMatchObject({ tempoBpm: 116, partLabel: 'SECONDO', musicXml: { value: xml } })
  await page.getByRole('button', { name: mode.label, exact: true }).click()
  await expect(page.locator('.score-renderer svg')).toBeVisible()
  await expect(page.locator('.current-measure')).toHaveText('5小節目')
  await expect(page.locator('.position')).toHaveText(`1 / ${mode.targets.length} ステップ`)
  await page.clock.install()
  await page.getByRole('button', { name: '練習開始', exact: true }).click()
  await page.evaluate(() => { window.midiTest.send([0x90, 61, 80]); window.midiTest.send([0x80, 61, 0]) })
  await expect(page.locator('.practice-feedback')).toHaveText('もう一度♪')
  for (const [index, target] of mode.targets.entries()) {
    await expect(page.locator('.current-measure')).toHaveText(`${mode.measures[index]}小節目`)
    await page.evaluate((pitches) => { for (const pitch of pitches) { window.midiTest.send([0x90, pitch, 80]); window.midiTest.send([0x80, pitch, 0]) } }, target)
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', String(index + 1))
  }
  await expect(page.locator('.practice-feedback')).toHaveText('できました！')
  await page.getByRole('button', { name: 'もう一度', exact: true }).click()
  await expect(page.locator('.current-measure')).toHaveText('5小節目')
  await page.evaluate(() => { window.midiTest.loopback = true })
  await page.getByRole('button', { name: '手本を聴く', exact: true }).click()
  let elapsed = 0
  for (const [index, onset] of mode.onsets.entries()) {
    const time = Math.ceil(onset * 60_000 / 116)
    await page.clock.runFor(time - elapsed); elapsed = time
    await expect(page.locator('.current-measure')).toHaveText(`${mode.measures[index]}小節目`)
    await expect(page.locator('.position')).toHaveText(`${index + 1} / ${mode.targets.length} ステップ`)
  }
  await page.clock.runFor(10000)
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'completed')
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', '0')
  const sent = await page.evaluate(() => window.midiTest.outputMessages), ons = sent.filter((message) => message.data[0] === 0x90)
  expect(ons).toHaveLength(mode.targets.flat().length)
  const started = ons[0].timestamp
  for (const [index, onset] of mode.onsets.entries()) {
    const chord = ons.filter((message) => Math.abs(message.timestamp - started - onset * 60_000 / 116) < 0.001)
    expect(chord.map((message) => message.data[1]).sort((a, b) => a - b)).toEqual(mode.targets[index])
    expect(new Set(chord.map((message) => message.timestamp)).size).toBe(1)
  }
  if (mode.label === '両手') {
    const firstCOff = sent.find((message) => message.data[0] === 0x80 && message.data[1] === 72)!
    expect(firstCOff.timestamp - started).toBeCloseTo(0.9 * 60_000 / 116, 6)
    await page.getByText('開発者用', { exact: true }).click()
    await expect(page.getByRole('region', { name: 'Score解析', exact: true })).toContainText('練習Step：右手 7 ／ 左手 5 ／ 両手 9')
    await page.screenshot({ path: 'test-results/phase2ed1-desktop.png', fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: 'test-results/phase2ed1-mobile.png', fullPage: true })
  }
  await page.getByRole('combobox', { name: '練習する曲' }).selectOption('twinkle-opening')
  await expect(page.locator('.current-measure')).toHaveText('1小節目')
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
})

test('metadata tempo survives reload and mode selection; XML wins; originalScore records are never rewritten', async ({ page }) => {
  await setup(page)
  const withoutTempo = xml.replace(/<direction>.*?<\/direction>/s, '')
  const old: ImportedSong[] = [
    { id: 'imported:metadata', title: 'metadata 116', tempoBpm: 116, musicXml: { type: 'text' as const, value: withoutTempo } },
    { id: 'imported:xml', title: 'XML 116', tempoBpm: 80, musicXml: { type: 'text' as const, value: xml } },
    { id: 'imported:default', title: '既定テンポ', musicXml: { type: 'text' as const, value: withoutTempo } },
  ].map((entry) => ({ ...entry, source: 'imported', composer: '以前の作者', partLabel: 'SECONDO', originalFileName: 'score.xml', fileFormat: 'musicxml', createdAt: 100,
    originalScore: { type: 'pdf', storageId: 'keep-this-reference', fileName: '自分の原譜.pdf' }, compatibility: { status: 'supported', version: 3, reasons: [] } }))
  await page.evaluate((entries) => new Promise<void>((resolve) => {
    const request = indexedDB.open('ai-piano-practice')
    request.onsuccess = () => { const db = request.result, tx = db.transaction('songs', 'readwrite'); for (const entry of entries) tx.objectStore('songs').add(entry); tx.oncomplete = () => { db.close(); resolve() } }
  }), old)
  const before = await records(page)
  await page.reload()
  await page.getByRole('button', { name: 'MIDI接続', exact: true }).click()
  await page.getByText('開発者用', { exact: true }).click()
  await page.clock.install()
  for (const [id, source, bpm] of [['metadata', 'Song metadata', 116], ['xml', 'MusicXML', 116], ['default', '既定値', 100]] as const) {
    await page.getByRole('combobox', { name: '練習する曲' }).selectOption('imported:' + id)
    await expect(page.locator('.current-measure')).toHaveText('5小節目')
    await page.getByRole('button', { name: '右手', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Score解析', exact: true })).toContainText(`${bpm} BPM（${source}）`)
    await page.evaluate(() => { window.midiTest.outputMessages.length = 0 })
    await page.getByRole('button', { name: '手本を聴く', exact: true }).click()
    await page.clock.runFor(700)
    const on = await page.evaluate(() => window.midiTest.outputMessages.filter((message) => message.data[0] === 0x90))
    expect(on[2].timestamp - on[0].timestamp).toBeCloseTo(60_000 / bpm, 6)
    await page.getByRole('button', { name: '停止', exact: true }).click()
  }
  expect(await records(page)).toEqual(before)
})

for (const kind of ['arpeggiate', 'grace']) test(kind + ': import report exposes the unsupported reason and selection cannot practice', async ({ page }) => {
  await setup(page)
  const modified = kind === 'arpeggiate' ? xml.replace('</note>', '<notations><arpeggiate/></notations></note>') : xml.replace('<note>', '<note><grace/>')
  await upload(page, modified)
  await form(page).getByText('楽譜解析結果を確認', { exact: true }).click()
  const report = form(page).getByRole('region', { name: '楽譜検証レポート' })
  await expect(report).toContainText('現在の練習・手本は未対応')
  await expect(report).toContainText(kind === 'grace' ? '装飾音' : 'アルペジオ')
  await saveAndSelect(page)
  await expect(page.getByRole('button', { name: '練習開始', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '手本を聴く', exact: true })).toBeDisabled()
  await expect(page.locator('.current-measure')).toHaveCount(0)
})

test('delete and re-import a corrected XML uses new tempo and measures without stale playback', async ({ page }) => {
  await setup(page); await upload(page); await saveAndSelect(page)
  await expect(page.locator('.position')).toHaveText('1 / 9 ステップ')
  const oldId = (await records(page))[0].id
  await page.clock.install()
  await page.getByRole('button', { name: '手本を聴く', exact: true }).click()
  await cards(page).getByRole('button', { name: '削除', exact: true }).click()
  await cards(page).getByRole('button', { name: '削除する', exact: true }).click()
  await expect(cards(page)).toHaveCount(0)
  await expect(page.locator('.current-measure')).toHaveText('1小節目')
  const stopped = await page.evaluate(() => window.midiTest.outputMessages.length)
  await page.clock.runFor(20000)
  expect(await page.evaluate(() => window.midiTest.outputMessages.length)).toBe(stopped)
  const corrected = xml.replaceAll('116', '120').replace('measure number="5"', 'measure number="9"')
  await upload(page, corrected); await saveAndSelect(page)
  await expect(page.locator('.current-measure')).toHaveText('9小節目')
  const [saved] = await records(page)
  expect(saved.id).not.toBe(oldId); expect(saved.tempoBpm).toBe(120); expect(saved.musicXml.value).toBe(corrected)
  await page.getByRole('button', { name: '手本を聴く', exact: true }).click()
  await page.clock.runFor(500)
  const on = await page.evaluate((count) => window.midiTest.outputMessages.slice(count).filter((message) => message.data[0] === 0x90), stopped)
  expect(on[4].timestamp - on[0].timestamp).toBe(500)
  expect(await page.evaluate(() => window.midiTest.requests)).toBe(1)
  expect(await page.evaluate(() => window.midiTest.inputListenerCount())).toBe(1)
})
