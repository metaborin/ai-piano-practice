import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockMidi } from './midiFixture'
import { referencePdf, referenceImage } from './originalFixtures'
import { fixture, parseFixture } from '../unit/xmlFixture'
import { createPracticePlan } from '../../src/practice/PracticePlan'
import { buildDemoPlan } from '../../src/audio/buildDemoPlan'
import { resolveDemoStart } from '../../src/audio/DemoStart'
import type { DemoStart } from '../../src/audio/DemoStart'

test.setTimeout(90_000)
const plan = createPracticePlan(parseFixture('maim-maim-full-original'), 'both')!
const occurrences = plan.sequence.occurrences
const second = occurrences.findIndex(o => o.repeatPass === 2)
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const state = (page: Page) => page.locator('.practice-controls')
async function setup(page: Page, image?: string) {
  await page.setViewportSize({ width: 1366, height: 768 }); await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockMidi(page); await page.goto('./'); await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await expect(button(page, '原譜で全画面練習')).toHaveCount(0)
  await button(page, 'MIDI接続').click()
  await page.locator('.song-import input').setInputFiles({ name: 'mayim.musicxml', mimeType: 'application/xml', buffer: Buffer.from(fixture('maim-maim-full-original')) })
  await page.getByRole('form', { name: '曲の登録確認' }).getByRole('button', { name: '追加する', exact: true }).click()
  const card = page.locator('.personal-song-list > li').first()
  await card.getByRole('button', { name: '選択', exact: true }).click()
  await expect(page.locator('.current-measure')).toHaveText('1小節目')
  await card.locator('.original-score-editor input').setInputFiles(image
    ? { name: 'reference.' + image, mimeType: 'image/' + (image === 'jpg' ? 'jpeg' : image), buffer: await referenceImage(page, 'image/' + (image === 'jpg' ? 'jpeg' : image)) }
    : { name: 'reference.pdf', mimeType: 'application/pdf', buffer: referencePdf() })
  await page.getByRole('form', { name: '元の楽譜の登録・削除確認' }).getByRole('button', { name: '登録する', exact: true }).click()
  await expect(button(page, '原譜で全画面練習')).toHaveCount(0)
  await button(page, '元の楽譜').click()
  if (image) await expect.poll(() => page.locator('.original-score-image').evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
  else {
    await expect(page.locator('.original-pdf')).toHaveAttribute('data-pages', '2')
    await expect(page.locator('.original-pdf canvas').first()).toHaveAttribute('data-rendered', 'true')
  }
}
async function clock(page: Page) { await page.clock.install(); await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 100))) }
async function strike(page: Page, notes: readonly number[]) {
  await page.evaluate(notes => {
    notes.forEach(n => window.midiTest.send([0x90, n, 80])); notes.forEach(n => window.midiTest.send([0x80, n, 0]))
  }, notes)
}
async function midi(page: Page) {
  return page.evaluate(() => ({ requests: window.midiTest.requests, listeners: window.midiTest.inputListenerCount(), clears: window.midiTest.outputClears.length, messages: window.midiTest.outputMessages.length }))
}
async function enter(page: Page) {
  await button(page, '原譜で全画面練習').click()
  await expect(page.locator('.practice-workspace')).toHaveAttribute('data-fullscreen', 'true')
  await expect(button(page, '× 全画面終了')).toBeVisible()
}
async function cursorVisible(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const c = document.querySelector('.score-renderer img')?.getBoundingClientRect(), v = document.querySelector('.score-view')?.getBoundingClientRect(), h = document.querySelector('.score-status')?.getBoundingClientRect()
    return !!(c && v && h && c.height > 0 && c.top >= Math.max(v.top, h.bottom, 0) - 1 && c.bottom <= Math.min(v.bottom, innerHeight) + 1)
  })).toBe(true)
}

test('until-correct PDF fullscreen retains partial practice, feedback, native exit and MIDI, then restores current OSMD viewport', async ({ page }) => {
  await setup(page); await button(page, '練習開始').click()
  // Reach the repeat's second pass in the existing mode before changing display.
  for (const o of occurrences.slice(0, second)) await strike(page, o.sourceTarget.expectedMidiNotes)
  await strike(page, [127]); await expect(page.locator('.practice-feedback')).toHaveText('もう一度♪')
  const prior = await midi(page), position = await page.locator('.position').innerText()
  await enter(page)
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('practice-workspace'))).toBe(true)
  await expect(page.locator('.position')).toHaveText(position)
  await expect(page.locator('.repeat-position')).toHaveText('反復 2回目')
  await expect(page.locator('.fullscreen-flow')).toHaveText('できるまで')
  await expect(page.locator('.practice-feedback')).toHaveText('もう一度♪')
  await expect(page.locator('.score-feedback')).toContainText('ちがう音：G9')
  await expect(page.locator('.score-overview')).toBeHidden()
  expect(await midi(page)).toEqual(prior)
  await strike(page, occurrences[second].sourceTarget.expectedMidiNotes)
  await expect(page.locator('.position')).toHaveText(`${second + 2} / ${occurrences.length} ステップ`)
  await page.screenshot({ path: 'test-results/phase2ee1-until-fullscreen.png' })
  // Browser-driven exit uses the same fullscreenchange path as native Esc.
  await page.evaluate(() => document.exitFullscreen())
  await expect(page.locator('.practice-workspace')).toHaveAttribute('data-fullscreen', 'false')
  expect(await midi(page)).toEqual(prior)
  await button(page, '練習用楽譜').click(); await cursorVisible(page)
  await expect(page.locator('.overview-current')).toHaveAttribute('data-moment', occurrences[second + 1].sourceMoment.id)
  await expect(button(page, '両手')).toHaveAttribute('aria-pressed', 'true')
  await expect(state(page)).toHaveAttribute('data-practice-status', 'practicing')
})

test('run-through with original PDF records wrong attempts, crosses repeat passes, completes and restarts from a clean session', async ({ page }) => {
  await setup(page); await button(page, '通し練習').click(); await button(page, '練習開始').click()
  await enter(page); await clock(page)
  const before = await midi(page), wrong = new Set([0, 30, second + 5])
  for (const [index, o] of occurrences.entries()) {
    await strike(page, wrong.has(index) ? [127] : o.sourceTarget.expectedMidiNotes)
    await page.clock.runFor(100)
    if (index === 0) {
      await expect(state(page)).toHaveAttribute('data-attempt-count', '1')
      await expect(page.locator('.practice-feedback')).toContainText('記録しました')
      await expect(page.locator('.score-feedback')).toContainText('ちがう音：G9')
      await expect(page.locator('[data-missing-note]')).toHaveCount(0)
      await button(page, '× 全画面終了').click(); await enter(page)
      await expect(state(page)).toHaveAttribute('data-attempt-count', '1')
    }
    if (index === second - 2) await expect(page.locator('.repeat-position')).toHaveText('反復 1回目')
    if (index === second - 1) {
      await expect(page.locator('.repeat-position')).toHaveText('反復 2回目')
      await expect(page.locator('.current-measure')).toHaveText('5小節目')
      await page.screenshot({ path: 'test-results/phase2ee1-run-repeat.png' })
    }
  }
  await expect(state(page)).toHaveAttribute('data-practice-status', 'completed')
  await expect(state(page)).toHaveAttribute('data-attempt-count', String(occurrences.length))
  await expect(page.locator('.practice-feedback')).toHaveText('通し練習が終わりました')
  await expect(page.locator('.run-through-summary')).toContainText(`正しく弾けた：${occurrences.length - wrong.size} / ${occurrences.length} ステップ`)
  for (const i of wrong) await expect(page.locator('.run-through-summary')).toContainText(`${occurrences[i].sourceMoment.measureNumber}小節目`)
  expect(await midi(page)).toEqual(before)
  await page.screenshot({ path: 'test-results/phase2ee1-run-complete.png' })
  await button(page, '練習・手本の操作').click(); await button(page, 'もう一度').click()
  await expect(state(page)).toHaveAttribute('data-attempt-count', '0')
  await expect(state(page)).toHaveAttribute('data-practice-index', '0')
  await expect(state(page)).toHaveAttribute('data-practice-status', 'practicing')
  await expect(page.locator('.run-through-summary')).toHaveCount(0)
})

test('flow change retains selected hands and start measure, cancels pending chord, resets safely and keeps MIDI connected', async ({ page }) => {
  await setup(page); await button(page, '右手').click()
  await page.getByRole('combobox', { name: '練習の開始位置', exact: true }).selectOption('measure:13')
  const position = await page.locator('.position').innerText(), before = await midi(page)
  await button(page, '通し練習').click(); await clock(page); await button(page, '練習開始').click()
  await strike(page, [60]); await button(page, 'できるまで').click(); await page.clock.runFor(500)
  await expect(state(page)).toHaveAttribute('data-practice-status', 'idle'); await expect(state(page)).toHaveAttribute('data-attempt-count', '0')
  await expect(page.locator('.position')).toHaveText(position)
  await expect(button(page, '右手')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('combobox', { name: '練習の開始位置', exact: true })).toHaveValue('measure:13')
  await button(page, '通し練習').click(); await button(page, '練習開始').click()
  await strike(page, [60, 64]); await page.clock.runFor(100)
  await expect(state(page)).toHaveAttribute('data-correct-count', '1')
  expect(await midi(page)).toEqual(before)
})

test('demo in fullscreen retains scheduling, occurrence and attempt history across entry/exit, with current OSMD recovery', async ({ page }) => {
  await setup(page); await button(page, '通し練習').click(); await button(page, '練習開始').click()
  await clock(page); await strike(page, [127]); await page.clock.runFor(100)
  await enter(page); await button(page, '練習・手本の操作').click()
  const practiceIndex = await state(page).getAttribute('data-practice-index')
  await button(page, '手本を聴く').click()
  const notes = buildDemoPlan(plan), jump = notes.find(n => n.index === second)!
  await page.clock.runFor(Math.ceil(jump.startMs) + 1)
  await expect(page.locator('.repeat-position')).toHaveText('反復 2回目')
  const before = await midi(page)
  await button(page, '× 全画面終了').click(); expect(await midi(page)).toEqual(before)
  await enter(page); expect(await midi(page)).toEqual(before)
  await strike(page, [60, 64, 67]); await page.clock.runFor(1000)
  await expect(state(page)).toHaveAttribute('data-attempt-count', '1')
  await expect(state(page)).toHaveAttribute('data-practice-index', practiceIndex!)
  const after = await midi(page); expect(after.messages).toBeGreaterThan(before.messages); expect(after.clears).toBe(before.clears)
  await button(page, '× 全画面終了').click(); await button(page, '練習用楽譜').click(); await page.clock.runFor(20)
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'playing')
  await cursorVisible(page)
  const index = Number((await page.locator('.position').innerText()).split(' / ')[0]) - 1
  await expect(page.locator('.overview-current')).toHaveAttribute('data-moment', occurrences[index].sourceMoment.id)
  const messages = await page.evaluate(() => window.midiTest.outputMessages)
  const ons = messages.filter(m => m.data[0] === 0x90)
  expect(new Set(ons.map(m => `${m.data[1]}:${m.timestamp}`)).size).toBe(ons.length)
  expect((await midi(page)).clears).toBe(before.clears)
  await button(page, '停止').click(); await page.clock.runFor(500)
  await expect(state(page)).toHaveAttribute('data-practice-status', 'practicing')
  await expect(state(page)).toHaveAttribute('data-attempt-count', '1')
})

for (const api of ['reject', 'unavailable'] as const) test(`fullscreen API ${api}: CSS viewport, Escape and accessible controls`, async ({ page }) => {
  await setup(page)
  await page.evaluate(kind => { Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: kind === 'reject' ? () => Promise.reject(new Error('denied')) : undefined }) }, api)
  await button(page, '練習開始').click(); const before = await midi(page)
  await enter(page)
  expect(await page.locator('.practice-workspace').boundingBox()).toEqual({ x: 0, y: 0, width: 1366, height: 768 })
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull()
  await button(page, '練習・手本の操作').click()
  await expect(button(page, 'もう一度')).toBeVisible(); await expect(button(page, '手本を聴く')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.practice-workspace')).toHaveAttribute('data-fullscreen', 'false')
  await expect(state(page)).toHaveAttribute('data-practice-status', 'practicing')
  await expect(button(page, 'MIDI接続済み')).toBeDisabled()
  expect(await midi(page)).toEqual(before)
  expect(await page.locator('.song-library').evaluate(el => (el as HTMLElement).inert)).toBe(false)
})

test('PDF zoom bounds, lazy multipage rendering and scroll survive fullscreen exit and re-entry without remounting', async ({ page }) => {
  await setup(page); await enter(page)
  const panel = page.locator('.original-score-view')
  await panel.evaluate(el => { el.scrollTop = 1600 })
  await expect(page.locator('.original-pdf canvas').nth(1)).toHaveAttribute('data-rendered', 'true')
  await button(page, '× 全画面終了').click(); await enter(page)
  await expect.poll(() => panel.evaluate(el => el.scrollTop)).toBe(1600)
  await button(page, '原譜を拡大').click()
  await expect(button(page, '原譜を100%に戻す')).toHaveText('125%')
  await expect.poll(() => panel.evaluate(el => el.querySelector('.original-score-content')!.clientWidth > el.clientWidth)).toBe(true)
  for (let i = 0; i < 3; i++) await button(page, '原譜を拡大').click()
  await expect(button(page, '原譜を拡大')).toBeDisabled()
  await expect.poll(() => panel.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
  await button(page, '原譜を100%に戻す').click()
  await button(page, '原譜を縮小').click(); await button(page, '原譜を縮小').click()
  await expect(button(page, '原譜を縮小')).toBeDisabled(); await expect(button(page, '原譜を100%に戻す')).toHaveText('50%')
  await button(page, '原譜を100%に戻す').click()
  await expect(page.locator('.original-pdf')).toHaveAttribute('data-pages', '2')
})

test('fullscreen demo supports beginning, current and specified measure; flow change explicitly stops playback and resets practice', async ({ page }) => {
  await setup(page); await button(page, '通し練習').click(); await button(page, '練習開始').click()
  await clock(page); await strike(page, [127]); await page.clock.runFor(100)
  await enter(page); await button(page, '練習・手本の操作').click()
  for (const choice of ['beginning', 'current', 'measure:20']) {
    const start: DemoStart = choice === 'beginning' ? { kind: 'beginning' } : choice === 'current' ? { kind: 'current', occurrenceIndex: 1, completed: false } : { kind: 'measure', measureIndex: 20 }
    const origin = resolveDemoStart(plan, start), notes = buildDemoPlan(plan, start)
    await page.getByRole('combobox', { name: '手本の開始位置' }).selectOption(choice)
    const previous = (await midi(page)).messages
    await button(page, '手本を聴く').click(); await page.clock.runFor(20)
    await expect(page.locator('.position')).toHaveText(`${origin.index + 1} / ${occurrences.length} ステップ`)
    const ons = await page.evaluate(from => window.midiTest.outputMessages.slice(from).filter(m => m.data[0] === 0x90).map(m => m.data[1]), previous)
    expect(ons).toEqual(notes.filter(n => n.startMs === 0).map(n => n.midiNote))
    await button(page, '停止').click(); await page.clock.runFor(500)
    await expect(state(page)).toHaveAttribute('data-attempt-count', '1')
  }
  await button(page, '手本を聴く').click(); const before = await midi(page)
  await button(page, 'できるまで').click(); await page.clock.runFor(500)
  await expect(state(page)).toHaveAttribute('data-practice-status', 'idle'); await expect(state(page)).toHaveAttribute('data-attempt-count', '0')
  await expect(state(page)).toHaveAttribute('data-practice-index', '0')
  await expect(page.locator('.demo-controls')).not.toHaveAttribute('data-demo-status', 'playing')
  expect((await midi(page)).clears).toBeGreaterThan(before.clears)
  expect((await midi(page)).requests).toBe(1); expect((await midi(page)).listeners).toBe(1)
})

test('a late fullscreen permission after exit cannot reopen the screen or reset the session', async ({ page }) => {
  await setup(page); await button(page, '練習開始').click()
  await page.evaluate(() => {
    let element: Element | null = null
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => element })
    HTMLElement.prototype.requestFullscreen = function () {
      return new Promise<void>(resolve => { Object.assign(window, { resolveFullscreenTest: () => { element = document.querySelector('.practice-workspace'); document.dispatchEvent(new Event('fullscreenchange')); resolve() } }) })
    }
    document.exitFullscreen = async () => { element = null; document.dispatchEvent(new Event('fullscreenchange')) }
  })
  const before = await midi(page)
  await enter(page); await button(page, '× 全画面終了').click()
  await page.evaluate(() => (window as unknown as { resolveFullscreenTest: () => void }).resolveFullscreenTest())
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
  await expect(page.locator('.practice-workspace')).toHaveAttribute('data-fullscreen', 'false')
  await expect(state(page)).toHaveAttribute('data-practice-status', 'practicing')
  expect(await midi(page)).toEqual(before)
})

for (const image of ['jpg', 'png', 'webp']) test(`${image} original supports fullscreen, zoom, scroll and narrow viewport controls`, async ({ page }) => {
  await setup(page, image); await enter(page)
  await button(page, '原譜を拡大').click(); await expect(button(page, '原譜を100%に戻す')).toHaveText('125%')
  await page.locator('.original-score-view').evaluate(el => { el.scrollTop = 700 })
  await expect.poll(() => page.locator('.original-score-view').evaluate(el => el.scrollTop)).toBe(700)
  await button(page, '× 全画面終了').click(); await enter(page)
  await expect.poll(() => page.locator('.original-score-view').evaluate(el => el.scrollTop)).toBe(700)
  await button(page, '× 全画面終了').click(); await page.setViewportSize({ width: 390, height: 844 })
  await enter(page)
  await expect(button(page, '× 全画面終了')).toBeInViewport()
  await expect(page.locator('.original-score-image')).toBeVisible()
  expect(await page.locator('.original-score-view').evaluate(el => el.clientHeight)).toBeGreaterThan(400)
  await button(page, '練習・手本の操作').click(); await expect(button(page, '練習開始')).toBeInViewport()
  await page.screenshot({ path: `test-results/phase2ee1-${image}-narrow.png` })
})
