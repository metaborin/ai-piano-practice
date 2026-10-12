import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockMidi } from './midiFixture'
import { parseXml } from '../unit/xmlFixture'
import { createPracticePlan } from '../../src/practice/PracticePlan'
import { buildDuetTimeline } from '../../src/practice/DuetPlan'
import { buildDemoPlan } from '../../src/audio/buildDemoPlan'

const speed = (page: Page) => page.getByRole('combobox', { name: '再生速度', exact: true })
const attacks = (page: Page) => page.evaluate(() => window.midiTest.outputMessages.filter(m => m.data[0] === 0x90))
const notesOff = (page: Page) => page.evaluate(() => window.midiTest.outputMessages.filter(m => m.data[0] === 0x80))
async function setup(page: Page) {
  await mockMidi(page); await page.goto('./')
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await page.getByRole('button', { name: 'MIDI接続', exact: true }).click()
  await expect(page.getByRole('button', { name: '手本を聴く', exact: true })).toBeEnabled()
}
async function freeze(page: Page) {
  await page.clock.install()
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 100)))
}
async function strike(page: Page, notes: readonly number[]) {
  await page.evaluate(notes => {
    for (const n of notes) window.midiTest.send([0x90, n, 80])
    for (const n of notes) window.midiTest.send([0x80, n, 0])
  }, notes)
}
const model = (part: string, version: string) => parseXml(readFileSync(`src/scores/duet/maim-maim-${part}-${version}.musicxml`, 'utf8'))

for (const rate of [0.5, 0.75, 1]) {
  test(`${rate * 100}%: the complete demo keeps pitch, note lengths, cursor timing and practice progress`, async ({ page }) => {
    await setup(page)
    await expect(speed(page)).toHaveValue('1')
    await speed(page).selectOption(String(rate))
    await page.getByRole('button', { name: '練習開始', exact: true }).click()
    await strike(page, [60])
    await freeze(page); await page.evaluate(() => { window.midiTest.loopback = true })
    await page.getByRole('button', { name: '手本を聴く', exact: true }).click()
    await expect(speed(page)).toBeDisabled()
    await expect(page.locator('.position')).toHaveText('1 / 14 音')
    await page.clock.runFor(600 / rate - 1)
    await expect(page.locator('.position')).toHaveText('1 / 14 音')
    await page.clock.runFor(2)
    await expect(page.locator('.position')).toHaveText('2 / 14 音')
    await expect(page.locator('.score-renderer img')).toBeVisible()
    await page.clock.runFor(9480 / rate - 600 / rate - 2)
    await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'playing')
    await page.clock.runFor(2)
    await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'completed')
    await expect(page.locator('.position')).toHaveText('2 / 14 音')
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', '1')
    const ons = await attacks(page), offs = await notesOff(page)
    expect(ons.map(m => m.data[1])).toEqual([60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60])
    ons.forEach((m, i) => {
      expect(offs[i].timestamp - m.timestamp).toBeCloseTo((i === 6 || i === 13 ? 1080 : 540) / rate, 2)
      if (i < 13) expect(ons[i + 1].timestamp - m.timestamp).toBeCloseTo((i === 6 ? 1200 : 600) / rate, 2)
    })
    await expect(speed(page)).toBeEnabled()
    await speed(page).selectOption(rate === 1 ? '0.5' : '1')
    await expect(page.locator('.position')).toHaveText('2 / 14 音')
    await strike(page, [61]); await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', '1')
    await strike(page, [60]); await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', '2')
    expect(await page.evaluate(() => window.midiTest.requests)).toBe(1)
    expect(await page.evaluate(() => window.midiTest.inputListenerCount())).toBe(1)
  })

  test(`${rate * 100}%: until-correct accompaniment waits for the same pitch and resumes only on correct input`, async ({ page }) => {
    await setup(page)
    await page.getByRole('combobox', { name: '練習する曲' }).selectOption('maim-maim-duet-once')
    await expect(page.locator('.position')).toHaveText('1 / 109 ステップ')
    await page.getByRole('combobox', { name: '練習対象パート' }).selectOption('primo')
    await expect(page.locator('.position')).toHaveText('1 / 118 ステップ')
    await speed(page).selectOption(String(rate))
    await page.getByRole('combobox', { name: '相手パート自動再生' }).selectOption('on')
    await freeze(page)
    await page.getByRole('button', { name: '練習開始', exact: true }).click()
    await expect(speed(page)).toBeDisabled()
    expect((await attacks(page))[0].data[1]).toBe(50)
    await strike(page, [60])
    const firstBoundary = 60000 / 232 / rate
    await page.clock.runFor(Math.ceil(firstBoundary) + 1)
    await expect(page.locator('.duet-controls')).toHaveAttribute('data-duet-status', 'waiting')
    await expect(speed(page)).toBeDisabled()
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', '0')
    const quiet = (await attacks(page)).length
    await page.clock.runFor(5000); expect(await attacks(page)).toHaveLength(quiet)
    await strike(page, [79])
    await expect(page.locator('.position')).toHaveText('2 / 118 ステップ')
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', '1')
    await page.getByRole('button', { name: '連弾練習を停止', exact: true }).click()
    await expect(speed(page)).toBeEnabled()
    const stopped = (await attacks(page)).length
    await page.clock.runFor(120000); expect(await attacks(page)).toHaveLength(stopped)
    expect(await page.evaluate(() => window.midiTest.outputMessages.some(m => m.data.join(',') === '176,123,0'))).toBe(true)
  })
}

for (const part of ['primo', 'secondo']) for (const version of ['once', 'original']) {
  test(`${part} ${version}: slower timed playback retains the opposite part, repeated current start and final results`, async ({ page }) => {
    const rate = version === 'once' ? 0.5 : 0.75
    const own = createPracticePlan(model(part, version))!, partner = createPracticePlan(model(part === 'primo' ? 'secondo' : 'primo', version))!
    const normal = buildDuetTimeline(own, partner)
    await setup(page)
    await page.getByRole('combobox', { name: '練習する曲' }).selectOption(`maim-maim-duet-${version}`)
    await expect(page.locator('.position')).toHaveText(`1 / ${version === 'once' ? 109 : 204} ステップ`)
    if (part === 'primo') await page.getByRole('combobox', { name: '練習対象パート' }).selectOption(part)
    await expect(page.locator('.position')).toHaveText(`1 / ${own.sequence.occurrences.length} ステップ`)
    await page.getByRole('button', { name: '通し練習', exact: true }).click()
    await page.getByRole('combobox', { name: '相手パート自動再生' }).selectOption('on')
    await speed(page).selectOption(String(rate))
    await freeze(page); await page.evaluate(() => { window.midiTest.loopback = true })
    await page.getByRole('button', { name: '練習開始', exact: true }).click()
    await page.clock.runFor(Math.ceil(normal.endMs / rate) + 1)
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status', 'completed')
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-attempt-count', String(own.sequence.occurrences.length))
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', '0')
    const ons = await attacks(page), offs = await notesOff(page), started = ons[0].timestamp
    expect(ons.map(m => m.data[1])).toEqual(normal.notes.map(n => n.midiNote))
    ons.forEach((m, i) => expect(m.timestamp - started).toBeCloseTo(normal.notes[i].startMs / rate, 2))
    offs.forEach((m, i) => expect(m.timestamp - started).toBeCloseTo(normal.notes[i].noteOffMs / rate, 2))
    expect(await page.evaluate(() => window.midiTest.outputClears)).toHaveLength(0)
    if (version === 'original') {
      await page.getByRole('combobox', { name: '練習の開始位置' }).selectOption('measure:29')
      await page.getByRole('button', { name: '練習開始', exact: true }).click()
      await page.clock.runFor(Math.ceil((normal.measureStarts[30] - normal.measureStarts[29]) / rate) + 1)
      await expect(page.locator('.current-measure')).toHaveText('5小節目')
      await expect(page.locator('.repeat-position')).toHaveText('反復 2回目')
      const index = Number(await page.locator('.practice-controls').getAttribute('data-practice-index'))
      await page.getByRole('button', { name: '連弾練習を停止', exact: true }).click()
      await speed(page).selectOption('0.5')
      await page.getByRole('combobox', { name: '練習の開始位置' }).selectOption('current')
      await page.getByRole('button', { name: '練習開始', exact: true }).click()
      await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-index', String(index))
      await expect(page.locator('.repeat-position')).toHaveText('反復 2回目')
      await page.clock.runFor(Math.ceil((normal.endMs - normal.targetStarts[index]) / 0.5) + 1)
      await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status', 'completed')
    }
    expect(await page.evaluate(() => window.midiTest.inputListenerCount())).toBe(1)
  })
}

test('silent timed duet uses 75% and stops its clock; song changes preserve speed and MIDI selection', async ({ page }) => {
  await setup(page)
  await page.getByRole('combobox', { name: '練習する曲' }).selectOption('maim-maim-duet-once')
  await expect(page.locator('.position')).toHaveText('1 / 109 ステップ')
  await page.getByRole('combobox', { name: '練習対象パート' }).selectOption('primo')
  await expect(page.locator('.position')).toHaveText('1 / 118 ステップ')
  await speed(page).selectOption('0.75')
  await page.getByRole('button', { name: '通し練習', exact: true }).click(); await freeze(page)
  await page.getByRole('button', { name: '練習開始', exact: true }).click()
  await page.clock.runFor(344)
  await expect(page.locator('.position')).toHaveText('1 / 118 ステップ')
  await page.clock.runFor(2)
  await expect(page.locator('.position')).toHaveText('2 / 118 ステップ')
  expect(await attacks(page)).toHaveLength(0)
  await page.getByRole('button', { name: 'すべての音を停止', exact: true }).click()
  const attempts = await page.locator('.practice-controls').getAttribute('data-attempt-count')
  await page.clock.runFor(120000)
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-attempt-count', attempts!)
  await expect(speed(page)).toBeEnabled()
  await page.getByRole('combobox', { name: '練習する曲' }).selectOption('twinkle-opening')
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await expect(speed(page)).toHaveValue('0.75')
  await expect(page.getByRole('combobox', { name: '出力機器' })).toHaveValue('cme-out')
})

test('50% leaves the 300ms chord matcher unchanged and works for partial solo demos and fullscreen PDF controls', async ({ page }) => {
  await setup(page)
  await page.getByRole('combobox', { name: '練習する曲' }).selectOption('harvest-time')
  await expect(page.locator('.position')).toHaveText('1 / 331 ステップ')
  await page.getByRole('button', { name: '元の楽譜', exact: true }).click()
  await expect(page.locator('.original-pdf canvas')).toHaveAttribute('data-rendered', 'true')
  await page.getByRole('button', { name: '練習用楽譜', exact: true }).click()
  await speed(page).selectOption('0.5'); await freeze(page)
  await page.getByRole('button', { name: '練習開始', exact: true }).click()
  await strike(page, [55]); await page.clock.runFor(301)
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', '0')
  await expect(page.locator('.feedback-notes').first()).toContainText('G4')
  await strike(page, [55, 67]); await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', '1')
  await expect(speed(page)).toBeEnabled()
  await page.getByRole('combobox', { name: '手本の開始位置' }).selectOption('measure:46')
  const plan = createPracticePlan(parseXml(readFileSync('src/scores/harvest-time.musicxml', 'utf8')))!
  const notes = buildDemoPlan(plan, { kind: 'measure', measureIndex: 46 })
  await page.getByRole('button', { name: '手本を聴く', exact: true }).click()
  await expect(page.locator('.current-measure')).toHaveText('47小節目')
  const first = await attacks(page), off = await notesOff(page)
  expect(first.map(m => m.data[1])).toEqual(notes.filter(n => n.startMs === 0).map(n => n.midiNote))
  off.forEach((m, i) => expect(m.timestamp - first[i].timestamp).toBeCloseTo(notes[i].noteOffMs / 0.5, 2))
  await page.getByRole('button', { name: '元の楽譜', exact: true }).click()
  // The simulated MIDI clock also pauses PDF animation frames. Let drawing
  // advance while checking that playback remains on the same musical clock.
  await expect.poll(async () => {
    await page.clock.runFor(100)
    return page.locator('.original-pdf canvas').getAttribute('data-rendered')
  }).toBe('true')
  await page.getByRole('button', { name: '原譜で全画面練習', exact: true }).click()
  await page.getByRole('button', { name: '練習・手本の操作', exact: true }).click()
  await expect(speed(page)).toBeVisible(); await expect(speed(page)).toBeDisabled()
  await page.getByRole('button', { name: '手本を停止', exact: true }).click()
  await expect(speed(page)).toBeEnabled(); await speed(page).selectOption('0.75')
  await page.getByRole('button', { name: '× 全画面終了', exact: true }).click()
  await page.getByRole('button', { name: '練習用楽譜', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.clock.runFor(100)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await speed(page).evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
  await page.screenshot({ path: 'test-results/playback-speed-mobile.png', fullPage: true })
})

test('without MIDI clear(), stopping slow playback drains old Offs before a new speed and never replays old notes', async ({ page }) => {
  await setup(page); await speed(page).selectOption('0.5'); await freeze(page)
  await page.evaluate(() => window.midiTest.disableOutputClear())
  await page.getByRole('button', { name: '手本を聴く', exact: true }).click()
  await page.clock.runFor(100)
  await page.getByRole('button', { name: '停止', exact: true }).click()
  await expect(speed(page)).toBeDisabled()
  const stopped = (await attacks(page)).length
  await page.clock.runFor(980)
  await expect(speed(page)).toBeEnabled(); expect(await attacks(page)).toHaveLength(stopped)
  await speed(page).selectOption('0.75')
  await page.getByRole('button', { name: '手本を聴く', exact: true }).click()
  await page.clock.runFor(800)
  const replay = (await attacks(page)).slice(stopped)
  expect(replay.map(m => m.data[1])).toEqual([60, 60])
  expect(replay[1].timestamp - replay[0].timestamp).toBeCloseTo(800, 2)
  await page.getByRole('combobox', { name: '練習する曲' }).selectOption('do-re-mi')
  await expect(page.locator('.position')).toHaveText('1 / 7 音')
  const changed = (await attacks(page)).length
  await page.clock.runFor(120000); expect(await attacks(page)).toHaveLength(changed)
  await expect(speed(page)).toHaveValue('0.75')
  expect(await page.evaluate(() => window.midiTest.requests)).toBe(1)
})
