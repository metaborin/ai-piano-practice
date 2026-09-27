import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockMidi } from './midiFixture'

const fixture = (file: string) => readFileSync(new URL('../fixtures/timeline/' + file + '.musicxml', import.meta.url), 'utf8')
const modes = [
  { label: '右手', targets: [[72, 76, 79], [74, 77], [76, 79], [72, 76], [74]], onsets: [0, 1, 2, 4, 6], wrong: 48 },
  { label: '左手', targets: [[48, 55], [50, 57], [52, 59], [53], [55]], onsets: [0, 2, 4, 5, 6], wrong: 72 },
  { label: '両手', targets: [[48, 55, 72, 76, 79], [74, 77], [50, 57, 76, 79], [52, 59, 72, 76], [53], [55, 74]], onsets: [0, 1, 2, 4, 5, 6], wrong: 61 },
]
async function setup(page: Page, file = 'g-piano-practice', xml = fixture(file)) {
  await mockMidi(page); await page.goto('./')
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await page.getByRole('button', { name: 'MIDI接続', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: file + '.musicxml', mimeType: 'application/xml', buffer: Buffer.from(xml) })
  await page.getByRole('form', { name: '曲の登録確認' }).getByRole('button', { name: '追加する', exact: true }).click()
  await page.locator('.personal-song-list > li').getByRole('button', { name: '選択', exact: true }).click()
  await expect(page.locator('.score-renderer svg')).toBeVisible()
}
async function notes(page: Page, pitches: number[], release = false) {
  await page.evaluate(({ pitches, release }) => { for (const pitch of pitches) window.midiTest.send([release ? 0x80 : 0x90, pitch, release ? 0 : 80]) }, { pitches, release })
}
const cursorPosition = (page: Page) => page.locator('.score-renderer img').evaluate((el) => `${(el as HTMLElement).offsetLeft}:${(el as HTMLElement).offsetTop}`)

for (const mode of modes) test(mode.label + ': chord grading, one-step cursor progression, completion, restart and selected-part demo', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: mode.label, exact: true }).click()
  await expect(page.locator('.position')).toHaveText(`1 / ${mode.targets.length} ステップ`)
  await page.clock.install()
  await page.getByRole('button', { name: '練習開始', exact: true }).click()
  const firstCursor = await cursorPosition(page)
  await notes(page, [mode.wrong]); await notes(page, [mode.wrong], true)
  await expect(page.locator('.practice-feedback')).toHaveText('もう一度♪')
  expect(await cursorPosition(page)).toBe(firstCursor)
  await notes(page, [mode.targets[0][0]])
  await page.clock.runFor(301)
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', '0')
  await expect(page.locator('.practice-feedback')).toHaveText('もう一度♪')
  await notes(page, mode.targets[0], true)
  for (const [index, target] of mode.targets.entries()) {
    const before = await cursorPosition(page)
    for (const pitch of [...target].reverse()) { await notes(page, [pitch]); await page.clock.runFor(40) }
    await notes(page, target, true)
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', String(index + 1))
    await expect(page.locator('.position')).toHaveText(`${Math.min(index + 2, mode.targets.length)} / ${mode.targets.length} ステップ`)
    if (index < mode.targets.length - 1) expect(await cursorPosition(page)).not.toBe(before)
  }
  await expect(page.locator('.practice-feedback')).toHaveText('できました！')
  await notes(page, [0, 127]); await notes(page, [0, 127], true)
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', String(mode.targets.length))
  await page.getByRole('button', { name: 'もう一度', exact: true }).click()
  expect(await cursorPosition(page)).toBe(firstCursor)
  await page.evaluate(() => { window.midiTest.loopback = true })
  await page.getByRole('button', { name: '手本を聴く', exact: true }).click()
  for (let index = 1; index < mode.onsets.length; index++) {
    await page.clock.runFor((mode.onsets[index] - mode.onsets[index - 1]) * 600)
    await expect(page.locator('.position')).toHaveText(`${index + 1} / ${mode.targets.length} ステップ`)
  }
  await page.clock.runFor(1080)
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'completed')
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', '0')
  const sent = await page.evaluate(() => window.midiTest.outputMessages)
  const ons = sent.filter((message) => message.data[0] === 0x90)
  const start = ons[0].timestamp
  expect(ons).toHaveLength(mode.targets.flat().length)
  for (const [index, target] of mode.targets.entries()) expect(ons.filter((message) => message.timestamp === start + mode.onsets[index] * 600).map((message) => message.data[1]).sort((a, b) => a - b)).toEqual(target)
})

test('mode switch cancels partial input and all sounding pitches; no late sound or state survives', async ({ page }) => {
  await setup(page); await page.clock.install()
  await page.getByRole('button', { name: '練習開始', exact: true }).click()
  await notes(page, [72, 76])
  await page.getByRole('button', { name: '左手', exact: true }).click()
  await page.clock.runFor(1000)
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status', 'idle')
  await expect(page.locator('.practice-feedback')).not.toHaveText('もう一度♪')
  await page.getByRole('button', { name: '両手', exact: true }).click()
  await page.getByRole('button', { name: '手本を聴く', exact: true }).click()
  await page.clock.runFor(100)
  const previousCount = await page.evaluate(() => window.midiTest.outputMessages.length)
  await page.getByRole('button', { name: '右手', exact: true }).click()
  const after = await page.evaluate(() => window.midiTest.outputMessages)
  expect(after.slice(previousCount).map((message) => message.data)).toEqual([[0x80, 72, 0], [0x80, 76, 0], [0x80, 79, 0], [0x80, 48, 0], [0x80, 55, 0], [0xb0, 123, 0]])
  await page.clock.runFor(20000)
  expect(await page.evaluate(() => window.midiTest.outputMessages)).toEqual(after)
  await expect(page.locator('.position')).toHaveText('1 / 5 ステップ')
  expect(await page.evaluate(() => window.midiTest.requests)).toBe(1)
  expect(await page.evaluate(() => window.midiTest.inputListenerCount())).toBe(1)
  await page.screenshot({ path: 'test-results/phase2ec2-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/phase2ec2-mobile.png', fullPage: true })
  await page.getByRole('combobox', { name: '練習する曲' }).selectOption('twinkle-opening')
  await expect(page.getByRole('region', { name: '練習するパート' })).toHaveCount(0)
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
})

test('tie continuation is skipped by practice/cursor and sustained by demo until its final Off', async ({ page }) => {
  await setup(page, 'h-ties'); await page.clock.install()
  await expect(page.locator('.position')).toHaveText('1 / 2 ステップ')
  await page.getByRole('button', { name: '練習開始', exact: true }).click()
  const first = await cursorPosition(page)
  await notes(page, [60, 64]); await notes(page, [64], true)
  await expect(page.locator('.position')).toHaveText('2 / 2 ステップ')
  expect(await cursorPosition(page)).not.toBe(first)
  await notes(page, [67])
  await expect(page.locator('.practice-feedback')).toHaveText('できました！')
  await page.getByRole('button', { name: '手本を聴く', exact: true }).click()
  await page.clock.runFor(2340)
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'completed')
  const sent = await page.evaluate(() => window.midiTest.outputMessages)
  const cOns = sent.filter((message) => message.data[0] === 0x90 && message.data[1] === 60)
  const cOffs = sent.filter((message) => message.data[0] === 0x80 && message.data[1] === 60)
  expect(cOns).toHaveLength(1); expect(cOffs).toHaveLength(1)
  expect(cOffs[0].timestamp - cOns[0].timestamp).toBe(2340)
})

test('arpeggiate score remains visible but never enters ordinary chord practice or demo', async ({ page }) => {
  await setup(page, 'b-chord', fixture('b-chord').replace('</note>', '<notations><arpeggiate/></notations></note>'))
  await expect(page.locator('.score-card').getByRole('status')).toContainText('アルペジオ')
  await expect(page.getByRole('button', { name: '練習開始', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '手本を聴く', exact: true })).toBeDisabled()
})

test('a part without attacks disables start/demo and hides the cursor; changing back recovers', async ({ page }) => {
  const xml = fixture('g-piano-practice').replace(/<note>.*?<\/note>/g, (note) => note.includes('<staff>2</staff>') ? '' : note)
  await setup(page, 'empty-left', xml)
  await page.getByRole('button', { name: '左手', exact: true }).click()
  await expect(page.locator('.score-card').getByRole('status')).toContainText('新しく押す音がありません')
  await expect(page.getByRole('button', { name: '練習開始', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '手本を聴く', exact: true })).toBeDisabled()
  await expect(page.locator('.score-renderer img')).toBeHidden()
  await page.getByRole('button', { name: '右手', exact: true }).click()
  await expect(page.locator('.position')).toHaveText('1 / 5 ステップ')
  await expect(page.locator('.score-renderer img')).toBeVisible()
})

for (const button of ['停止', 'すべての音を停止']) test(button + ': every sounding chord key stops and no future Note On returns', async ({ page }) => {
  await setup(page); await page.clock.install()
  await page.getByRole('button', { name: '手本を聴く', exact: true }).click()
  await page.clock.runFor(100)
  const count = await page.evaluate(() => window.midiTest.outputMessages.length)
  await page.getByRole('button', { name: button, exact: true }).click()
  const after = await page.evaluate(() => window.midiTest.outputMessages)
  expect(after.slice(count).filter((message) => message.data[0] === 0x80).map((message) => message.data[1]).sort((a, b) => a - b)).toEqual([48, 55, 72, 76, 79])
  expect(after.at(-1)!.data).toEqual([0xb0, 123, 0])
  await page.clock.runFor(20000)
  expect(await page.evaluate(() => window.midiTest.outputMessages)).toEqual(after)
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'stopped')
  await page.getByRole('button', { name: '手本を聴く', exact: true }).click()
  await expect(page.locator('.position')).toHaveText('1 / 6 ステップ')
})
