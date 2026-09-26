import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockMidi } from './midiFixture'

const fixture = (name: string) => readFileSync(new URL('../fixtures/timeline/' + name + '.musicxml', import.meta.url), 'utf8')
const catalog = [
  { file: 'a-simple', staff: 1, voice: '1', moments: 3, notes: 3, rest: 0, beats: 3, simple: true },
  { file: 'b-chord', staff: 1, voice: '1', moments: 1, notes: 3, rest: 0, beats: 1 },
  { file: 'c-grand-staff', staff: 2, voice: '1, 2', moments: 1, notes: 4, rest: 0, beats: 1 },
  { file: 'd-two-voices', staff: 1, voice: '1, 2', moments: 2, notes: 3, rest: 0, beats: 2 },
  { file: 'e-rest', staff: 1, voice: '1', moments: 1, notes: 1, rest: 1, beats: 2 },
  { file: 'f-backup-forward', staff: 1, voice: '1, 2', moments: 3, notes: 3, rest: 0, beats: 3 },
]
async function setup(page: Page) {
  await mockMidi(page)
  await page.goto('./')
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await page.getByRole('button', { name: 'MIDI接続', exact: true }).click()
}
async function add(page: Page, file: string) {
  await page.locator('input[type=file]').setInputFiles({ name: file + '.musicxml', mimeType: 'application/xml', buffer: Buffer.from(fixture(file)) })
  const form = page.getByRole('form', { name: '曲の登録確認' })
  await expect(form.getByRole('button', { name: '追加する', exact: true })).toBeEnabled()
  await form.getByRole('button', { name: '追加する', exact: true }).click()
  await expect(form).toHaveCount(0)
  await page.locator('.personal-song-list > li').last().getByRole('button', { name: '選択', exact: true }).click()
}

for (const score of catalog) test(score.file + ': import, normalized analysis and original OSMD rendering share the selected score', async ({ page }) => {
  await setup(page)
  await add(page, score.file)
  await expect(page.locator('.score-renderer svg')).toBeVisible()
  await expect(page.locator('.score-card').getByRole('alert')).toHaveCount(0)
  await page.getByText('開発者用', { exact: true }).click()
  const analysis = page.getByRole('region', { name: 'Score解析', exact: true })
  await expect(analysis).toContainText(`Staff：${score.staff} ／ Voice：${score.voice}`)
  await expect(analysis).toContainText(`Moment：${score.moments} ／ Notes：${score.notes} ／ Rest：${score.rest}`)
  await expect(analysis).toContainText('総拍数：' + score.beats)
  if (score.simple) {
    await expect(page.locator('.position')).toHaveText('1 / 3 音')
    await page.getByRole('button', { name: '練習開始', exact: true }).click()
    await page.evaluate(() => { window.midiTest.send([0x90, 60, 80]); window.midiTest.send([0x80, 60, 0]) })
    await expect(page.locator('.position')).toHaveText('2 / 3 音')
  } else {
    await expect(page.locator('.score-card').getByRole('status')).toContainText('次Phase（2E-C2）')
    await expect(page.locator('.position')).toHaveText('— / — 音')
    for (const name of ['練習開始', 'もう一度', '手本を聴く', '前の音', '次の音']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled()
    await page.evaluate(() => { for (const note of [60, 64, 67, 72, 48, 55]) { window.midiTest.send([0x90, note, 80]); window.midiTest.send([0x80, note, 0]) } })
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', '0')
    expect(await page.evaluate(() => window.midiTest.outputMessages.length)).toBe(0)
    await expect(page.locator('.score-renderer img')).toBeHidden()
  }
  if (score.file === 'c-grand-staff') {
    await expect(page.locator('.score-renderer svg .staffline')).toHaveCount(2)
    await expect(page.locator('.score-renderer .vf-notehead')).toHaveCount(4)
    await page.screenshot({ path: 'test-results/phase2ec1-grand-staff-desktop.png', fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: 'test-results/phase2ec1-grand-staff-mobile.png', fullPage: true })
  }
  await page.getByRole('combobox', { name: '練習する曲' }).selectOption('twinkle-opening')
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await expect(page.getByRole('button', { name: '手本を聴く' })).toBeEnabled()
})

test('existing Phase 2E-B records are reanalysed without migration, rewriting XML or losing metadata', async ({ page }) => {
  const oldRecords = [
    { id: 'imported:old-melody', title: '以前の単旋律', composer: '以前の作者', musicXml: { type: 'text', value: fixture('a-simple') }, compatibility: { status: 'supported', version: 1, reasons: [] } },
    { id: 'imported:old-grand', title: '以前の大譜表', composer: '別の作者', musicXml: { type: 'text', value: fixture('c-grand-staff') }, compatibility: { status: 'unsupported', version: 1, reasons: ['和音', '複数Staff'] } },
  ].map((song) => ({ ...song, source: 'imported', partLabel: '追加曲', originalFileName: song.id + '.xml', fileFormat: 'musicxml', createdAt: 100, originalScore: { type: 'pdf', storageId: 'future-reference-only' } }))
  await setup(page)
  await page.evaluate((records) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('ai-piano-practice', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result, transaction = db.transaction('songs', 'readwrite')
      for (const record of records) transaction.objectStore('songs').add(record)
      transaction.oncomplete = () => { db.close(); resolve() }
    }
  }), oldRecords)
  await page.reload()
  await expect(page.locator('.personal-song-list > li')).toHaveCount(2)
  const complex = page.locator('[data-song-id="imported:old-grand"]')
  await expect(complex).toContainText('解析可能・練習は次Phase')
  await complex.getByRole('button', { name: '選択', exact: true }).click()
  await expect(page.locator('.score-renderer svg .staffline')).toHaveCount(2)
  await page.locator('[data-song-id="imported:old-melody"]').getByRole('button', { name: '選択', exact: true }).click()
  await expect(page.locator('.position')).toHaveText('1 / 3 音')
  const after = await page.evaluate(() => new Promise<unknown[]>((resolve) => {
    const request = indexedDB.open('ai-piano-practice', 1)
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('songs'), get = tx.objectStore('songs').getAll()
      tx.oncomplete = () => { db.close(); resolve(get.result) }
    }
  }))
  expect(after).toEqual([...oldRecords].sort((a, b) => a.id.localeCompare(b.id)))
})

test('switching a playing melody to a complex score stops sound, timers and old notifications without losing MIDI', async ({ page }) => {
  await setup(page)
  await add(page, 'c-grand-staff')
  await expect(page.locator('.score-renderer svg')).toBeVisible()
  await page.getByRole('combobox', { name: '練習する曲' }).selectOption('twinkle-opening')
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await page.clock.install()
  await page.getByRole('button', { name: '手本を聴く', exact: true }).click()
  await page.locator('.personal-song-list > li').getByRole('button', { name: '選択', exact: true }).click()
  await expect(page.locator('.score-card').getByRole('status')).toContainText('次Phase')
  const sent = await page.evaluate(() => window.midiTest.outputMessages)
  expect(sent.slice(-2).map((message) => message.data)).toEqual([[0x80, 60, 0], [0xb0, 123, 0]])
  await page.clock.runFor(20000)
  expect(await page.evaluate(() => window.midiTest.outputMessages)).toEqual(sent)
  await expect(page.getByRole('button', { name: '手本を聴く', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => window.midiTest.requests)).toBe(1)
  expect(await page.evaluate(() => window.midiTest.inputListenerCount())).toBe(1)
})
