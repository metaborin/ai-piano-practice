import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockMidi } from './midiFixture'

const melody = [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60]
async function setup(page: Page) {
  await mockMidi(page)
  await page.goto('./')
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await expect(page.getByRole('button', { name: '手本を聴く' })).toBeDisabled()
  await page.getByRole('button', { name: 'MIDI接続', exact: true }).click()
  await expect(page.getByRole('button', { name: '手本を聴く' })).toBeEnabled()
}

test('plays the actual XML score in order with durations and cursor, ignores loopback and returns to practice', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: '練習開始' }).click()
  await page.evaluate(() => { window.midiTest.send([0x90, 60, 80]); window.midiTest.send([0x80, 60, 0]); window.midiTest.loopback = true })
  await expect(page.locator('.position')).toHaveText('2 / 14 音')
  await page.getByRole('button', { name: '手本を聴く' }).click()
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status', 'demoPlaying')
  await expect(page.getByRole('button', { name: '再生中…' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '練習開始' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'もう一度', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'テスト音 C4' })).toBeDisabled()
  await page.evaluate(() => { window.midiTest.send([0x90, 67, 70]); window.midiTest.send([0x80, 67, 0]) })
  const cursor = page.locator('.score-renderer img')
  let lastCursor = ''
  for (let index = 0; index < 14; index++) {
    await expect(page.locator('.position')).toHaveText(`${index + 1} / 14 音`)
    await expect(cursor).toBeVisible()
    const position = await cursor.evaluate((element) => `${(element as HTMLImageElement).offsetLeft}:${(element as HTMLImageElement).offsetTop}`)
    expect(position).not.toBe(lastCursor)
    lastCursor = position
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', '0')
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-index', '0')
    if (index === 4) await page.screenshot({ path: 'test-results/phase2cb-playing.png', fullPage: true })
  }
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'completed')
  await expect(page.locator('.demo-message')).toHaveText('手本の再生が終わりました')
  await expect(page.locator('.position')).toHaveText('14 / 14 音')
  await expect(page.getByTestId('latest-input')).toContainText('Note Off')
  const sent = await page.evaluate(() => window.midiTest.outputMessages)
  const ons = sent.filter(({ data }) => data[0] === 0x90)
  const offs = sent.filter(({ data }) => data[0] === 0x80)
  expect(ons.map(({ data }) => data[1])).toEqual(melody)
  expect(offs.map(({ data }) => data[1])).toEqual(melody)
  for (let index = 0; index < 14; index++) {
    expect(ons[index].data).toEqual([0x90, melody[index], 80])
    expect(offs[index].data).toEqual([0x80, melody[index], 0])
    expect(offs[index].timestamp - ons[index].timestamp).toBeCloseTo(index === 6 || index === 13 ? 1080 : 540, 2)
    if (index < 13) expect(ons[index + 1].timestamp - ons[index].timestamp).toBeCloseTo(index === 6 ? 1200 : 600, 2)
  }
  await page.screenshot({ path: 'test-results/phase2cb-completed.png', fullPage: true })
  await page.getByRole('button', { name: '練習開始' }).click()
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await page.evaluate(() => window.midiTest.send([0x90, 60, 80]))
  await expect(page.locator('.position')).toHaveText('2 / 14 音')
})

test('stop prevents later notes and replay restarts at note one even without clear()', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => window.midiTest.disableOutputClear())
  await page.getByRole('button', { name: '手本を聴く' }).click()
  await expect(page.locator('.position')).toHaveText('3 / 14 音')
  await page.getByRole('button', { name: '停止', exact: true }).click()
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'stopped')
  expect(await page.evaluate(() => window.midiTest.outputMessages.slice(-2).map(({ data }) => data))).toEqual([[0x80, 67, 0], [0xb0, 123, 0]])
  const count = await page.evaluate(() => window.midiTest.outputMessages.length)
  await expect(page.getByRole('button', { name: '手本を聴く' })).toBeEnabled()
  await page.waitForTimeout(900) // Beyond the cancelled next-note timer, not just the disabled UI.
  expect(await page.evaluate(() => window.midiTest.outputMessages.length)).toBe(count)
  await page.getByRole('button', { name: '手本を聴く' }).click()
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await page.getByRole('button', { name: 'すべての音を停止' }).click()
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'stopped')
  await expect(page.getByRole('button', { name: '練習開始' })).toBeEnabled()
})

test('unplug and output selection cancel the demo; reconnect never automatically replays', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: '手本を聴く' }).click()
  await page.evaluate(() => window.midiTest.setOutputConnected('cme-out', false))
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'stopped')
  await expect(page.getByRole('button', { name: '手本を聴く' })).toBeDisabled()
  const count = await page.evaluate(() => window.midiTest.outputMessages.length)
  await page.evaluate(() => window.midiTest.setOutputConnected('cme-out', true))
  await expect(page.getByRole('button', { name: '手本を聴く' })).toBeEnabled()
  expect(await page.evaluate(() => window.midiTest.outputMessages.length)).toBe(count)
  await page.getByRole('button', { name: '手本を聴く' }).click()
  await page.getByRole('combobox', { name: '出力機器' }).selectOption('')
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'stopped')
  await expect(page.getByRole('button', { name: '手本を聴く' })).toBeDisabled()
  await expect(page.locator('.midi-status')).toHaveText('MIDI 接続中')
})

test('send errors leave practice usable and a narrow viewport keeps all controls accessible', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await setup(page)
  await page.evaluate(() => { window.midiTest.failSend = true })
  await page.getByRole('button', { name: '手本を聴く' }).click()
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'error')
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status', 'idle')
  await page.evaluate(() => { window.midiTest.failSend = false })
  await page.getByRole('button', { name: '出力を再接続' }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: '手本を聴く' }).click()
  await page.getByRole('button', { name: '停止', exact: true }).click()
  await page.getByRole('button', { name: '練習開始' }).click()
  await page.evaluate(() => window.midiTest.send([0x90, 60, 80]))
  await expect(page.locator('.position')).toHaveText('2 / 14 音')
  await page.screenshot({ path: 'test-results/phase2cb-mobile.png', fullPage: true })
  expect(errors).toEqual([])
})

test('hiding or leaving the page stops playback and never resumes automatically', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: '手本を聴く' }).click()
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'stopped')
  await expect(page.getByTestId('latest-output')).toContainText('All Notes Off')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'stopped')
  await page.getByRole('button', { name: '手本を聴く' }).click()
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'stopped')
  await expect(page.getByTestId('latest-output')).toContainText('All Notes Off')
})
