import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockMidi } from './midiFixture'

const xml = readFileSync(new URL('../fixtures/timeline/j-long-practice.musicxml', import.meta.url), 'utf8')
const both = [[48, 55, 72, 76, 79], [74], [50, 57, 76, 79], [77]]
const right = [[72, 76, 79], [74], [76, 79], [77]], left = [[48, 55], [50, 57]]
async function setup(page: Page) {
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockMidi(page); await page.goto('./')
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await page.getByRole('button', { name: 'MIDI接続', exact: true }).click()
  await page.locator('.song-import input[type=file]').setInputFiles({ name: 'long-study.musicxml', mimeType: 'application/xml', buffer: Buffer.from(xml) })
  await page.getByRole('form', { name: '曲の登録確認' }).getByRole('button', { name: '追加する', exact: true }).click()
  const started = Date.now()
  await page.locator('.personal-song-list > li').getByRole('button', { name: '選択', exact: true }).click()
  await expect(page.locator('.position')).toHaveText('1 / 128 ステップ')
  await expect(page.locator('.score-renderer svg')).toBeVisible()
  await test.info().attach('long-score-selection-time', { body: JSON.stringify({ measures: 32, moments: 128, notes: 352, selectionToReadyMs: Date.now() - started }), contentType: 'application/json' })
}
async function advance(page: Page, from: number, count: number, targets = both) {
  await page.evaluate(({ from, count, targets }) => {
    for (let i = from; i < from + count; i++) for (const pitch of targets[i % targets.length]) {
      window.midiTest.send([0x90, pitch, 80]); window.midiTest.send([0x80, pitch, 0])
    }
  }, { from, count, targets })
}
async function position(page: Page) {
  return page.evaluate(() => {
    const view = document.querySelector('.score-view') as HTMLElement, cursor = document.querySelector('.score-renderer img') as HTMLElement
    if (!view || !cursor) return { scroll: 0, left: 0, cursorTop: 0, cursorBottom: 0, viewTop: 0, viewBottom: 0, visible: false }
    const v = view.getBoundingClientRect(), c = cursor.getBoundingClientRect(), header = document.querySelector('.score-status')!.getBoundingClientRect()
    return { scroll: view.scrollTop, left: view.scrollLeft, cursorTop: c.top, cursorBottom: c.bottom, viewTop: v.top, viewBottom: v.bottom,
      visible: c.top >= Math.max(v.top, header.bottom, 0) - 1 && c.bottom <= Math.min(v.bottom, innerHeight) + 1 && c.left >= v.left - 1 && c.right <= v.right + 1 }
  })
}
async function visible(page: Page) { await expect.poll(async () => (await position(page)).visible).toBe(true) }
async function clock(page: Page) { await page.clock.install(); await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 100))) }

test('next system follows smoothly, in-view steps stay still, manual scrolling stays put until return or progression', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: '練習開始', exact: true }).click(); await visible(page)
  const before = await position(page)
  await advance(page, 0, 1)
  await expect(page.locator('.position')).toHaveText('2 / 128 ステップ')
  await visible(page)
  expect((await position(page)).scroll).toBe(before.scroll)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() => {
    const view = document.querySelector('.score-view') as HTMLElement, scrollTo = view.scrollTo.bind(view)
    view.scrollTo = ((options: ScrollToOptions) => { view.dataset.lastBehavior = options.behavior; scrollTo(options) }) as typeof view.scrollTo
  })
  // Wait for React's MIDI update and the asynchronous smooth move separately.
  // Several systems ensure an off-screen target even with different CI fonts.
  await advance(page, 1, 15)
  await expect(page.locator('.position')).toHaveText('17 / 128 ステップ')
  await expect.poll(async () => (await position(page)).scroll).toBeGreaterThan(before.scroll)
  await visible(page)
  await expect(page.locator('.score-view')).toHaveAttribute('data-last-behavior', 'smooth')
  await page.evaluate(() => document.querySelector('.score-view')!.scrollTo({ top: 3500, behavior: 'instant' }))
  const manual = await position(page); expect(manual.visible).toBe(false)
  await page.waitForTimeout(400)
  expect((await position(page)).scroll).toBe(manual.scroll)
  await page.getByRole('button', { name: '現在位置へ戻る', exact: true }).click(); await visible(page)
  expect((await position(page)).scroll).toBeLessThan(manual.scroll)
  await page.evaluate(() => document.querySelector('.score-view')!.scrollTo({ top: 3500, behavior: 'instant' }))
  await advance(page, 16, 1)
  await expect(page.locator('.position')).toHaveText('18 / 128 ステップ')
  await visible(page)
})

test('late practice cursor and red noteheads, three-digit progress, resize and restart remain usable', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: '練習開始', exact: true }).click()
  await advance(page, 0, 96); await visible(page)
  await expect(page.locator('.position')).toHaveText('97 / 128 ステップ')
  await expect(page.locator('.current-measure')).toHaveText('29小節目')
  expect((await position(page)).scroll).toBeGreaterThan(2000)
  await page.evaluate(() => { for (const pitch of [48, 55, 72, 76, 81]) { window.midiTest.send([0x90, pitch, 80]); window.midiTest.send([0x80, pitch, 0]) } })
  const red = page.locator('.score-renderer [data-missing-note]')
  await expect(red).toHaveCount(1); await expect(red).toHaveAttribute('data-midi-pitch', '79')
  await expect(red.locator('path').first()).toHaveCSS('fill', 'rgb(198, 40, 40)')
  expect((await red.boundingBox())!.y).toBeGreaterThan((await page.locator('.score-status').boundingBox())!.y)
  await page.screenshot({ path: 'test-results/phase2ed2-late-chord.png' })
  await page.setViewportSize({ width: 390, height: 844 }); await visible(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.getByRole('button', { name: '現在位置へ戻る', exact: true })).toHaveCSS('min-height', '48px')
  await expect(red).toHaveCount(1)
  await advance(page, 96, 8); await visible(page)
  await expect(page.locator('.position')).toHaveText('105 / 128 ステップ')
  await page.screenshot({ path: 'test-results/phase2ed2-mobile.png' })
  await page.getByRole('button', { name: 'もう一度', exact: true }).click(); await visible(page)
  await expect(page.locator('.position')).toHaveText('1 / 128 ステップ')
  expect((await position(page)).scroll).toBe(0)
  await expect(red).toHaveCount(0)
})

for (const mode of [{ label: '右手', targets: right, total: 128 }, { label: '左手', targets: left, total: 64 }, { label: '両手', targets: both, total: 128 }]) {
  test(mode.label + ': late measure is visible before first MIDI, demo follows systems and stop/end restore practice', async ({ page }) => {
    await setup(page)
    await page.getByRole('button', { name: mode.label, exact: true }).click()
    await page.getByRole('button', { name: '練習開始', exact: true }).click()
    const practiceIndex = 4 * mode.targets.length
    await advance(page, 0, practiceIndex, mode.targets); await visible(page)
    const practicePosition = (await position(page)).scroll
    const select = page.getByRole('combobox', { name: '手本の開始位置' })
    await expect(select.locator('option')).toHaveCount(34)
    await expect(select.locator('option').filter({ hasText: /^17小節目/ })).toHaveCount(0)
    await clock(page)
    await page.evaluate(() => {
      window.midiTest.loopback = true
      const messages = window.midiTest.outputMessages, push = messages.push.bind(messages)
      messages.push = (...items) => {
        for (const item of items) if (item.data[0] === 0x90 && !document.body.dataset.firstMidiView) {
          const view = document.querySelector('.score-view')!.getBoundingClientRect(), c = document.querySelector('.score-renderer img')!.getBoundingClientRect()
          const header = document.querySelector('.score-status')!.getBoundingClientRect()
          document.body.dataset.firstMidiView = String(c.top >= Math.max(view.top, header.bottom, 0) && c.bottom <= Math.min(view.bottom, innerHeight))
          document.body.dataset.firstMidiMeasure = document.querySelector('.current-measure')!.textContent!
        }
        return push(...items)
      }
    })
    await select.selectOption('measure:24')
    await page.getByRole('button', { name: '手本を聴く', exact: true }).click(); await visible(page)
    expect(await page.evaluate(() => document.body.dataset.firstMidiView)).toBe('true')
    expect(await page.evaluate(() => document.body.dataset.firstMidiMeasure)).toBe('29小節目')
    const lateScroll = (await position(page)).scroll; expect(lateScroll).toBeGreaterThan(practicePosition)
    await page.clock.runFor(Math.ceil(8 * 60000 / 116)); await visible(page)
    expect((await position(page)).scroll).toBeGreaterThan(lateScroll)
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-index', String(practiceIndex))
    await page.getByRole('button', { name: '停止', exact: true }).click(); await visible(page)
    await expect(page.locator('.current-measure')).toHaveText('5小節目')
    expect((await position(page)).scroll).toBeLessThan(lateScroll)
    const count = await page.evaluate(() => window.midiTest.outputMessages.length)
    await page.clock.runFor(120000)
    expect(await page.evaluate(() => window.midiTest.outputMessages.length)).toBe(count)
    await select.selectOption('measure:31')
    await page.getByRole('button', { name: '手本を聴く', exact: true }).click(); await visible(page)
    await expect(page.locator('.current-measure')).toHaveText('36小節目')
    await page.clock.runFor(3000); await visible(page)
    await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'completed')
    await expect(page.locator('.position')).toHaveText(`${practiceIndex + 1} / ${mode.total} ステップ`)
    await expect(page.locator('.current-measure')).toHaveText('5小節目')
    await select.selectOption('current')
    await page.getByRole('button', { name: '手本を聴く', exact: true }).click(); await visible(page)
    await expect(page.locator('.current-measure')).toHaveText('5小節目')
    await page.getByRole('button', { name: '停止', exact: true }).click()
  })
}

test('mode and song switches reset scroll, colors and progress while preserving MIDI; manual demo browsing is not forced back each beat', async ({ page }) => {
  await setup(page); await clock(page)
  await page.getByRole('combobox', { name: '手本の開始位置' }).selectOption('measure:24')
  await page.getByRole('button', { name: '手本を聴く', exact: true }).click(); await visible(page)
  await page.evaluate(() => document.querySelector('.score-view')!.scrollTo({ top: 0, behavior: 'instant' }))
  await page.clock.runFor(600)
  expect((await position(page)).scroll).toBe(0)
  await page.getByRole('button', { name: '現在位置へ戻る', exact: true }).click(); await visible(page)
  expect((await position(page)).scroll).toBeGreaterThan(2000)
  await page.getByRole('button', { name: '左手', exact: true }).click(); await visible(page)
  expect((await position(page)).scroll).toBe(0)
  await expect(page.locator('.position')).toHaveText('1 / 64 ステップ')
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status', 'idle')
  await page.getByRole('combobox', { name: '手本の開始位置' }).selectOption('measure:24')
  await page.getByRole('button', { name: '手本を聴く', exact: true }).click(); await visible(page)
  await page.getByRole('combobox', { name: '練習する曲' }).selectOption('twinkle-opening'); await visible(page)
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  expect((await position(page)).scroll).toBe(0)
  const stopped = await page.evaluate(() => window.midiTest.outputMessages.length)
  await page.clock.runFor(120000)
  expect(await page.evaluate(() => window.midiTest.outputMessages.length)).toBe(stopped)
  expect(await page.evaluate(() => window.midiTest.requests)).toBe(1)
  expect(await page.evaluate(() => window.midiTest.inputListenerCount())).toBe(1)
})
