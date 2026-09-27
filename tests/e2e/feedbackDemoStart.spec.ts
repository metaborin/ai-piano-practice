import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockMidi } from './midiFixture'

const fixture = (name: string) => readFileSync(new URL(`../fixtures/timeline/${name}.musicxml`, import.meta.url), 'utf8')
async function setup(page: Page, file?: string, xml?: string) {
  await mockMidi(page); await page.goto('./')
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await page.getByRole('button', { name: 'MIDI接続', exact: true }).click()
  if (file) {
    await page.locator('input[type=file]').setInputFiles({ name: `${file}.musicxml`, mimeType: 'application/xml', buffer: Buffer.from(xml ?? fixture(file)) })
    await page.getByRole('form', { name: '曲の登録確認' }).getByRole('button', { name: '追加する', exact: true }).click()
    await page.locator('.personal-song-list > li').getByRole('button', { name: '選択', exact: true }).click()
    await expect(page.locator('.score-renderer svg')).toBeVisible()
  }
  await page.clock.install()
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 100)))
}
async function notes(page: Page, pitches: number[], off = false) {
  await page.evaluate(({ pitches, off }) => { for (const pitch of pitches) window.midiTest.send([off ? 0x80 : 0x90, pitch, off ? 0 : 80]) }, { pitches, off })
}
const red = (page: Page) => page.locator('.score-renderer [data-missing-note]')
const cursor = (page: Page) => page.locator('.score-renderer img').evaluate((el) => `${(el as HTMLElement).offsetLeft}:${(el as HTMLElement).offsetTop}`)

test('pending stays neutral, timeout colors only missing G, unexpected A is text, retry and success clear the SVG', async ({ page }) => {
  await setup(page, 'b-chord')
  await page.getByRole('button', { name: '練習開始', exact: true }).click()
  const heads = page.locator('.score-renderer [data-score-notes]'), count = await heads.count()
  const height = await page.locator('.score-status').evaluate((el) => el.getBoundingClientRect().height)
  await notes(page, [60, 64]); await page.clock.runFor(300)
  await expect(red(page)).toHaveCount(0)
  await expect(page.locator('.practice-feedback')).toHaveText('音をそろえてみよう')
  await page.clock.runFor(1)
  await expect(red(page)).toHaveCount(1)
  await expect(red(page)).toHaveAttribute('data-midi-pitch', '67')
  await expect(red(page)).toHaveCSS('fill', 'rgb(198, 40, 40)')
  await expect(red(page).locator('path').first()).toHaveCSS('fill', 'rgb(198, 40, 40)')
  await expect(page.locator('.score-feedback')).toContainText('足りない音：G4')
  await notes(page, [60, 64], true); await notes(page, [60])
  await expect(red(page)).toHaveCount(0)
  await notes(page, [64, 69])
  await expect(red(page)).toHaveCount(1)
  await expect(red(page)).toHaveAttribute('data-midi-pitch', '67')
  await expect(page.locator('.score-feedback')).toContainText('ちがう音：A4')
  await expect(heads).toHaveCount(count)
  expect(await page.locator('.score-status').evaluate((el) => el.getBoundingClientRect().height)).toBe(height)
  await page.setViewportSize({ width: 1366, height: 768 }); await page.clock.runFor(50)
  await expect(red(page)).toHaveCount(1)
  await page.evaluate(() => window.scrollTo(0, document.querySelector('.score-card')!.getBoundingClientRect().top + window.scrollY))
  await page.screenshot({ path: 'test-results/phase2ed11-missing-chord.png' })
  await notes(page, [60, 64, 69], true); await notes(page, [60, 64, 67])
  await expect(red(page)).toHaveCount(0)
  await expect(page.locator('.practice-feedback')).toHaveText('できました！')
  await expect(page.locator('.score-renderer [data-midi-pitch="67"] path').first()).toHaveCSS('fill', 'rgb(0, 0, 0)')
  await expect(page.locator('.score-feedback')).not.toContainText('ちがう音')
})

test('single-note error colors the expected note and clears on restart and song replacement', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: '練習開始', exact: true }).click(); await notes(page, [62])
  await expect(red(page)).toHaveCount(1); await expect(red(page)).toHaveAttribute('data-midi-pitch', '60')
  await expect(page.locator('.score-feedback')).toContainText('ちがう音：D4')
  await page.getByRole('button', { name: 'もう一度', exact: true }).click(); await expect(red(page)).toHaveCount(0)
  await notes(page, [62], true); await notes(page, [62]); await expect(red(page)).toHaveCount(1)
  await page.getByRole('combobox', { name: '練習する曲' }).selectOption('do-re-mi')
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status', 'idle')
  await expect(red(page)).toHaveCount(0)
  await expect(page.locator('.score-feedback')).not.toContainText('ちがう音')
})

test('feedback remains at the score top during scrolling without moving the notation; mode switch clears all colors', async ({ page }) => {
  const xml = fixture('g-piano-practice').replace('<measure number="2">', '<measure number="2"><print new-system="yes"/>')
  await setup(page, 'g-piano-practice', xml)
  await page.setViewportSize({ width: 1366, height: 768 }); await page.clock.runFor(50)
  await page.getByRole('button', { name: '練習開始', exact: true }).click()
  await page.evaluate(() => window.scrollTo(0, document.querySelector('.score-card')!.getBoundingClientRect().top + window.scrollY + 80))
  const feedback = page.locator('.score-status'), sheet = page.locator('.score-view')
  const before = await sheet.boundingBox()
  expect((await feedback.boundingBox())!.y).toBe(0)
  await notes(page, [72, 76, 48, 55]); await notes(page, [81])
  await expect(red(page)).toHaveCount(1); await expect(red(page)).toHaveAttribute('data-midi-pitch', '79')
  expect(await sheet.boundingBox()).toEqual(before)
  await expect(feedback.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  await page.screenshot({ path: 'test-results/phase2ed11-sticky.png' })
  await page.getByRole('button', { name: '左手', exact: true }).click(); await expect(red(page)).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 }); await page.clock.runFor(50)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.getByRole('combobox', { name: '手本の開始位置' })).toHaveCSS('min-height', '48px')
  await page.locator('.score-card').scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/phase2ed11-mobile.png' })
})

const modes = [
  { name: '右手', first: [72, 76, 79], next: [74, 77], second: [72, 76], index: 3, total: 5, staff: [72, 76, 74] },
  { name: '左手', first: [48, 55], next: [50, 57], second: [52, 59], index: 2, total: 5, staff: [52, 59, 53, 55] },
  { name: '両手', first: [48, 55, 72, 76, 79], next: [74, 77], second: [52, 59, 72, 76], index: 3, total: 6, staff: [72, 76, 52, 59, 53, 74, 55] },
]
for (const mode of modes) test(`${mode.name}: current and measure demo move cursor before MIDI; stop/end restore practice and cancel all later sound`, async ({ page }) => {
  await setup(page, 'g-piano-practice')
  await page.getByRole('button', { name: mode.name, exact: true }).click()
  await page.getByRole('button', { name: '練習開始', exact: true }).click()
  await notes(page, mode.first); await notes(page, mode.first, true)
  const practiceCursor = await cursor(page)
  await page.evaluate(() => {
    window.midiTest.loopback = true
    // Observe actual DOM at the first MIDI send, before the sequencer can publish again.
    const messages = window.midiTest.outputMessages, push = messages.push.bind(messages)
    messages.push = (...items) => {
      for (const item of items) if (item.data[0] === 0x90) {
        const el = document.querySelector('.score-renderer img') as HTMLElement
        document.body.dataset.firstMidiPosition ??= document.querySelector('.position')!.textContent!
        document.body.dataset.firstMidiCursor ??= `${el.offsetLeft}:${el.offsetTop}`
      }
      return push(...items)
    }
  })
  await page.getByRole('combobox', { name: '手本の開始位置' }).selectOption('current')
  await page.getByRole('button', { name: '手本を聴く', exact: true }).click()
  expect(await page.evaluate(() => document.body.dataset.firstMidiCursor)).toBe(practiceCursor)
  const currentOns = await page.evaluate(() => window.midiTest.outputMessages.filter((m) => m.data[0] === 0x90).map((m) => m.data[1]))
  expect(currentOns).toEqual(expect.arrayContaining(mode.next)) // Includes notes already sustaining at this onset.
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', '1')
  await page.getByRole('button', { name: '停止', exact: true }).click()
  expect(await cursor(page)).toBe(practiceCursor)
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status', 'practicing')
  const stopped = await page.evaluate(() => window.midiTest.outputMessages.slice())
  expect(stopped.at(-1)!.data).toEqual([0xb0, 123, 0])
  for (const pitch of currentOns) expect(stopped.some((m) => m.data[0] === 0x80 && m.data[1] === pitch)).toBe(true)
  await page.clock.runFor(10000)
  expect(await page.evaluate(() => window.midiTest.outputMessages)).toEqual(stopped)
  await page.evaluate(() => { window.midiTest.outputMessages.length = 0; delete document.body.dataset.firstMidiCursor; delete document.body.dataset.firstMidiPosition })
  await page.getByRole('combobox', { name: '手本の開始位置' }).selectOption('measure:1')
  await page.getByRole('button', { name: '手本を聴く', exact: true }).click()
  expect(await page.evaluate(() => document.body.dataset.firstMidiPosition)).toBe(`${mode.index + 1} / ${mode.total} ステップ`)
  expect(await page.evaluate(() => document.body.dataset.firstMidiCursor)).toBe(await cursor(page))
  expect(await cursor(page)).not.toBe(practiceCursor)
  const initial = await page.evaluate(() => window.midiTest.outputMessages.filter((m) => m.data[0] === 0x90).map((m) => m.data[1]).sort((a, b) => a - b))
  expect(initial).toEqual(mode.second)
  await expect(page.locator('.current-measure')).toHaveText('2小節目')
  await page.clock.runFor(4000)
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'completed')
  expect(await cursor(page)).toBe(practiceCursor)
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-index', '1')
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', '1')
  const ons = await page.evaluate(() => window.midiTest.outputMessages.filter((m) => m.data[0] === 0x90).map((m) => m.data[1]))
  expect(ons).toEqual(mode.staff)
  await notes(page, mode.next); await notes(page, mode.next, true)
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', '2')
})
