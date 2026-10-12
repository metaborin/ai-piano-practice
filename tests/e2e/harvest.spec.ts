import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockMidi } from './midiFixture'
import { parseXml } from '../unit/xmlFixture'
import { createPracticePlan } from '../../src/practice/PracticePlan'
import { buildDemoPlan } from '../../src/audio/buildDemoPlan'

test.setTimeout(90_000)
const score = parseXml(readFileSync(new URL('../../src/scores/harvest-time.musicxml', import.meta.url), 'utf8'))
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
async function setup(page: Page) {
  await page.setViewportSize({ width: 1366, height: 900 }); await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockMidi(page); await page.goto('./')
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await button(page, 'MIDI接続').click()
  await page.getByRole('combobox', { name: '練習する曲' }).selectOption('harvest-time')
  await expect(page.locator('.position')).toHaveText('1 / 331 ステップ')
  await expect(page.getByRole('heading', { name: '刈り入れ時', exact: true, level: 1 })).toBeVisible()
  await expect(page.locator('.score-renderer svg')).toBeVisible()
  await expect(page.locator('.score-overview')).toHaveAttribute('data-state', 'ready')
  await expect(page.locator('.duet-controls')).toHaveCount(0)
}
async function strike(page: Page, targets: readonly (readonly number[])[]) {
  await page.evaluate(groups => { for (const notes of groups) {
    notes.forEach(p => window.midiTest.send([0x90, p, 80]))
    notes.forEach(p => window.midiTest.send([0x80, p, 0]))
  } }, targets)
}
const modes = [
  { mode: 'right' as const, label: '右手', steps: 225 },
  { mode: 'left' as const, label: '左手', steps: 268 },
  { mode: 'both' as const, label: '両手', steps: 331 },
]

for (const { mode, label, steps } of modes) test(`刈り入れ時 ${label}: built-in solo practice, full completion and selected-hand demo from bar 47`, async ({ page }) => {
  await setup(page); await button(page, label).click()
  await expect(page.locator('.position')).toHaveText(`1 / ${steps} ステップ`)
  await page.clock.install(); await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 100)))
  const plan = createPracticePlan(score, mode)!
  await button(page, '練習開始').click()
  await strike(page, [[60]])
  await expect(page.locator('.practice-feedback')).toHaveText('もう一度♪')
  await expect(page.locator('.position')).toHaveText(`1 / ${steps} ステップ`)
  await strike(page, plan.targets.map(t => t.expectedMidiNotes))
  await expect(page.locator('.practice-feedback')).toHaveText('できました！')
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', String(steps))
  await expect(page.locator('.current-measure')).toHaveText('57小節目')
  await button(page, 'もう一度').click()
  await expect(page.locator('.position')).toHaveText(`1 / ${steps} ステップ`)
  await expect(page.locator('.current-measure')).toHaveText('1小節目')
  await page.getByRole('combobox', { name: '手本の開始位置' }).selectOption('measure:46')
  await page.evaluate(() => { window.midiTest.loopback = true })
  await button(page, '手本を聴く').click()
  await expect(page.locator('.current-measure')).toHaveText('47小節目')
  await page.clock.runFor(20_000)
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'completed')
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', '0')
  const on = await page.evaluate(() => window.midiTest.outputMessages.filter(m => m.data[0] === 0x90))
  const expected = buildDemoPlan(plan, { kind: 'measure', measureIndex: 46 })
  expect(on.map(m => m.data[1])).toEqual(expected.map(n => n.midiNote))
  for (const [i, event] of expected.entries()) expect(on[i].timestamp - on[0].timestamp).toBeCloseTo(event.startMs, 5)
  expect(await page.evaluate(() => window.midiTest.requests)).toBe(1)
  expect(await page.evaluate(() => window.midiTest.inputListenerCount())).toBe(1)
})

test('the built-in original PDF and fullscreen retain solo progress and MIDI without importing a file', async ({ page }) => {
  await setup(page)
  await expect(page.locator('.personal-song-list > li')).toHaveCount(0)
  await button(page, '練習開始').click()
  await strike(page, [[55, 67]])
  await expect(page.locator('.position')).toHaveText('2 / 331 ステップ')
  await button(page, '元の楽譜').click()
  await expect(page.locator('.original-pdf')).toHaveAttribute('data-pages', '1')
  await expect(page.locator('.original-pdf canvas')).toHaveAttribute('data-rendered', 'true')
  await button(page, '原譜で全画面練習').click()
  await expect(page.locator('.practice-workspace')).toHaveAttribute('data-fullscreen', 'true')
  await strike(page, [[59]])
  await expect(page.locator('.position')).toHaveText('3 / 331 ステップ')
  await page.screenshot({ path: 'test-results/harvest-original-fullscreen.png' })
  await button(page, '× 全画面終了').click()
  await button(page, '練習用楽譜').click()
  await expect(page.locator('.score-overview')).toBeVisible()
  await expect(page.locator('.position')).toHaveText('3 / 331 ステップ')
  await page.screenshot({ path: 'test-results/harvest-solo-score.png', fullPage: true })
  await page.getByRole('combobox', { name: '練習する曲' }).selectOption('twinkle-opening')
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await expect(button(page, '元の楽譜')).toHaveCount(0)
  expect(await page.evaluate(() => window.midiTest.requests)).toBe(1)
  expect(await page.evaluate(() => window.midiTest.inputListenerCount())).toBe(1)
})

test('a failed original PDF shows a recoverable reference error without changing the practice score', async ({ page }) => {
  await page.route('**/scores/harvest-time-original.pdf', route => route.fulfill({ status: 404, body: '' }))
  await setup(page); await button(page, '元の楽譜').click()
  await expect(page.locator('.original-score-view')).toContainText('内蔵曲の原譜を読み込めませんでした')
  await button(page, '練習用楽譜').click()
  await expect(page.locator('.position')).toHaveText('1 / 331 ステップ')
  await expect(button(page, '練習開始')).toBeEnabled()
  await page.unroute('**/scores/harvest-time-original.pdf')
  await button(page, '元の楽譜').click()
  await expect(page.locator('.original-pdf canvas')).toHaveAttribute('data-rendered', 'true')
})

test('solo run-through keeps the existing input-driven behavior and records a wrong final chord', async ({ page }) => {
  await setup(page)
  await page.getByRole('combobox', { name: '練習の開始位置' }).selectOption('measure:56')
  await button(page, '通し練習').click()
  await page.clock.install(); await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 100)))
  await button(page, '練習開始').click()
  await page.clock.runFor(5000)
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-attempt-count', '0')
  await strike(page, [[60]]); await page.clock.runFor(100)
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status', 'completed')
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-attempt-count', '1')
  await expect(page.locator('.practice-feedback')).toHaveText('通し練習が終わりました')
  await expect(page.locator('.run-through-summary')).toContainText('57小節目')
  await expect(page.locator('.run-through-summary')).toContainText('正しく弾けた：0 / 1 ステップ')
  await button(page, 'もう一度').click()
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-attempt-count', '0')
  await expect(page.locator('.current-measure')).toHaveText('57小節目')
})

test('solo song/hand changes stop all sound and reset the start; no previous duet or solo events return', async ({ page }) => {
  await setup(page); await page.clock.install(); await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 100)))
  await button(page, '手本を聴く').click()
  await page.clock.runFor(100)
  await button(page, '右手').click()
  const stopped = await page.evaluate(() => window.midiTest.outputMessages)
  expect(stopped.at(-1)?.data).toEqual([0xb0, 123, 0])
  expect(stopped.some(m => m.data[0] === 0x80 && m.data[1] === 55)).toBe(true)
  expect(stopped.some(m => m.data[0] === 0x80 && m.data[1] === 67)).toBe(true)
  await page.clock.runFor(100_000)
  expect(await page.evaluate(() => window.midiTest.outputMessages)).toEqual(stopped)
  await page.getByRole('combobox', { name: '練習の開始位置' }).selectOption('measure:56')
  await button(page, '練習開始').click(); await strike(page, [[59, 67]])
  await expect(page.locator('.practice-feedback')).toHaveText('できました！')
  await page.getByRole('combobox', { name: '練習する曲' }).selectOption('maim-maim-duet-original')
  await expect(page.locator('.position')).toHaveText('1 / 204 ステップ')
  await expect(page.locator('.duet-controls')).toBeVisible()
  await page.getByRole('combobox', { name: '練習する曲' }).selectOption('harvest-time')
  await expect(page.locator('.position')).toHaveText('1 / 331 ステップ')
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status', 'idle')
  await expect(page.locator('.duet-controls')).toHaveCount(0)
  await expect(page.locator('.current-measure')).toHaveText('1小節目')
  expect(await page.evaluate(() => window.midiTest.requests)).toBe(1)
  expect(await page.evaluate(() => window.midiTest.inputListenerCount())).toBe(1)
})
