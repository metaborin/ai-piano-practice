import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { mockMidi } from './midiFixture'

test('MusicXML contains the requested fourteen pitches and four complete bars', async ({ page }) => {
  await page.goto('./')
  const xml = readFileSync(new URL('../../src/scores/twinkle.musicxml', import.meta.url), 'utf8')
  const result = await page.evaluate((xml) => {
    const doc = new DOMParser().parseFromString(xml, 'text/xml')
    const semitones: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
    return {
      errors: doc.querySelectorAll('parsererror').length,
      pitches: [...doc.querySelectorAll('note')].map((note) => 12 * (Number(note.querySelector('octave')!.textContent) + 1) + semitones[note.querySelector('step')!.textContent!]),
      durations: [...doc.querySelectorAll('measure')].map((measure) => [...measure.querySelectorAll('duration')].reduce((sum, duration) => sum + Number(duration.textContent), 0)),
    }
  }, xml)
  expect(result).toEqual({ errors: 0, pitches: [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60], durations: [4, 4, 4, 4] })
})

test('renders the score, traverses all notes in both directions and retains position after resize', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('./')
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await expect(page.locator('.score-renderer svg')).toHaveCount(1)
  await expect(page.locator('.score-renderer .vf-stavenote')).toHaveCount(14)
  const cursor = page.locator('.score-renderer img')
  await expect(cursor).toHaveCount(1)
  await expect(cursor).toBeVisible()
  const initial = await cursor.boundingBox()
  await expect(page.getByRole('button', { name: '前の音' })).toBeDisabled()
  for (let index = 2; index <= 14; index++) {
    const previous = await cursor.boundingBox()
    await page.getByRole('button', { name: '次の音' }).click()
    await expect(page.locator('.position')).toHaveText(`${index} / 14 音`)
    expect(await cursor.boundingBox()).not.toEqual(previous)
  }
  await expect(page.getByRole('button', { name: '次の音' })).toBeDisabled()
  for (let index = 13; index >= 1; index--) {
    await page.getByRole('button', { name: '前の音' }).click()
    await expect(page.locator('.position')).toHaveText(`${index} / 14 音`)
  }
  expect(await cursor.boundingBox()).toEqual(initial)
  await page.getByRole('button', { name: '次の音' }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.position')).toHaveText('2 / 14 音')
  await expect(cursor).toBeVisible()
  await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  // Compare score-relative coordinates: Playwright scrolls the viewport to reach touch controls.
  const scorePosition = () => cursor.evaluate((element) => {
    const image = element as HTMLImageElement
    return { x: image.offsetLeft, y: image.offsetTop }
  })
  const resizedSecond = await scorePosition()
  await page.getByRole('button', { name: '前の音' }).click()
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  expect(await scorePosition()).not.toEqual(resizedSecond)
  await page.getByRole('button', { name: '次の音' }).click()
  expect(await scorePosition()).toEqual(resizedSecond)
  await page.getByRole('button', { name: '前の音' }).click()
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true })
  expect(errors).toEqual([])
})

test('MIDI is opt-in, prefers CME, reports note data and never advances the score', async ({ page }) => {
  await mockMidi(page)
  await page.goto('./')
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  expect(await page.evaluate(() => window.midiTest.requests)).toBe(0)
  await page.evaluate(() => window.midiTest.setConnected('other', true))
  await page.getByRole('button', { name: 'MIDI接続', exact: true }).click()
  await expect(page.locator('.midi-status')).toHaveText('MIDI 接続中')
  await expect(page.getByRole('combobox')).toHaveValue('cme')
  await expect(page.locator('.connection-copy')).toContainText('CME Pro')
  const before = await page.locator('.score-renderer img').boundingBox()
  for (const velocity of [20, 33, 96]) {
    await page.evaluate((velocity) => window.midiTest.send([0x90, 60, velocity]), velocity)
    const latest = page.getByTestId('latest-input')
    await expect(latest.locator('.note-name strong')).toHaveText('C4')
    await expect(latest.locator('dd')).toHaveText(['60', String(velocity), 'Note On', '1'])
  }
  await page.evaluate(() => window.midiTest.send([0x80, 60, 40]))
  await expect(page.getByTestId('latest-input').locator('dd')).toHaveText(['60', '40', 'Note Off', '1'])
  await expect(page.locator('.event-summaries')).toContainText('Velocity 96')
  await page.evaluate(() => window.midiTest.send([0x9f, 67, 0]))
  await expect(page.getByTestId('latest-input').locator('dd')).toHaveText(['67', '0', 'Note Off', '16'])
  await page.evaluate(() => { window.midiTest.send([0xb0, 64, 127]); window.midiTest.send([0xfe]); window.midiTest.send([0x90, 60, 72], 'other') })
  await expect(page.getByTestId('latest-input').locator('dd')).toHaveText(['67', '0', 'Note Off', '16'])
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  expect(await page.locator('.score-renderer img').boundingBox()).toEqual(before)
  await page.getByRole('combobox').selectOption('other')
  await page.evaluate(() => window.midiTest.send([0x91, 72, 55], 'other'))
  await expect(page.getByTestId('latest-input').locator('dd')).toHaveText(['72', '55', 'Note On', '2'])
})

test('waiting input hotplugs and reconnects without another permission request', async ({ page }) => {
  await mockMidi(page, false)
  await page.goto('./')
  await page.getByRole('button', { name: 'MIDI接続', exact: true }).click()
  await expect(page.locator('.midi-status')).toHaveText('MIDI 接続待ち')
  await page.evaluate(() => window.midiTest.setConnected('cme', true))
  await expect(page.locator('.midi-status')).toHaveText('MIDI 接続中')
  await page.evaluate(() => window.midiTest.send([0x90, 60, 72]))
  await expect(page.getByTestId('latest-input')).toBeVisible()
  await page.evaluate(() => window.midiTest.setConnected('cme', false))
  await expect(page.locator('.midi-status')).toHaveText('MIDI 接続待ち')
  await expect(page.getByTestId('latest-input')).toHaveCount(0)
  await page.evaluate(() => window.midiTest.setConnected('cme', true))
  await expect(page.locator('.midi-status')).toHaveText('MIDI 接続中')
  await page.evaluate(() => window.midiTest.send([0x90, 60, 33]))
  await expect(page.getByTestId('latest-input').locator('dd')).toHaveText(['60', '33', 'Note On', '1'])
  expect(await page.evaluate(() => window.midiTest.requests)).toBe(1)
})

test('permission denial and failed port open can be retried', async ({ page }) => {
  await mockMidi(page)
  await page.goto('./')
  await page.evaluate(() => { window.midiTest.denied = true })
  await page.getByRole('button', { name: 'MIDI接続', exact: true }).click()
  await expect(page.locator('.midi-status')).toHaveText('MIDI エラー')
  await expect(page.locator('.connection-copy')).toContainText('許可されていません')
  await page.evaluate(() => { window.midiTest.denied = false; window.midiTest.failOpen = true })
  await page.getByRole('button', { name: 'MIDI接続', exact: true }).click()
  await expect(page.locator('.connection-copy')).toContainText('入力機器を開けませんでした')
  await page.evaluate(() => { window.midiTest.failOpen = false })
  await page.getByRole('button', { name: 'MIDI接続', exact: true }).click()
  await expect(page.locator('.midi-status')).toHaveText('MIDI 接続中')
})

test('unsupported MIDI gives an actionable error while the score still works', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'requestMIDIAccess', { value: undefined, configurable: true }))
  await page.goto('./')
  await page.getByRole('button', { name: 'MIDI接続', exact: true }).click()
  await expect(page.locator('.connection-copy')).toContainText('Google Chromeで開いてください')
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await page.getByRole('button', { name: '次の音' }).click()
  await expect(page.locator('.position')).toHaveText('2 / 14 音')
})

test('insecure origins explain the HTTPS requirement', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true }))
  await page.goto('./')
  await page.getByRole('button', { name: 'MIDI接続', exact: true }).click()
  await expect(page.locator('.midi-status')).toHaveText('MIDI エラー')
  await expect(page.locator('.connection-copy')).toContainText('HTTPS')
})
