import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockMidi } from './midiFixture'
import { fixture, parseFixture } from '../unit/xmlFixture'
import { createPracticePlan } from '../../src/practice/PracticePlan'
import type { PracticeMode, PracticePlan } from '../../src/practice/PracticePlan'
import { buildDemoPlan } from '../../src/audio/buildDemoPlan'
import { LOOKAHEAD_MS } from '../../src/audio/DemoLookAhead'

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const overview = (page: Page) => page.locator('.score-overview')
async function setup(page: Page, name?: string, mode: PracticeMode = 'both') {
  await page.setViewportSize({ width: 1366, height: 768 }); await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockMidi(page); await page.goto('./'); await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await button(page, 'MIDI接続').click()
  if (name) {
    await page.locator('input[type=file]').setInputFiles({ name: name + '.musicxml', mimeType: 'application/xml', buffer: Buffer.from(fixture(name)) })
    await page.getByRole('form', { name: '曲の登録確認' }).getByRole('button', { name: '追加する', exact: true }).click()
    await page.locator('.personal-song-list > li').getByRole('button', { name: '選択', exact: true }).click()
    await button(page, { right: '右手', left: '左手', both: '両手' }[mode]).click()
  }
  await expect(overview(page)).toHaveAttribute('data-state', 'ready')
  await expect(overview(page)).toHaveAttribute('data-render-count', '1')
  await expect(overview(page).locator('.overview-current')).not.toHaveAttribute('hidden', '')
}
async function geometry(page: Page) {
  return overview(page).evaluate(root => {
    const panel = document.querySelector<HTMLElement>('.score-view')!, host = document.querySelector<HTMLElement>('.score-renderer > div')!
    const v = panel.getBoundingClientRect(), h = host.getBoundingClientRect()
    const image = root.querySelector<HTMLImageElement>('img')!, marker = root.querySelector<HTMLElement>('.overview-current')!
    const data = (root as HTMLElement).dataset
    return { top: Number(data.viewportTop), height: Number(data.viewportHeight), count: Number(data.renderCount), updates: Number(data.viewportUpdates), renderTimeMs: Number(data.renderTime),
      moment: marker.dataset.moment, markerTop: Number(marker.dataset.top), markerTransform: marker.style.transform, url: image.src,
      expectedTop: Math.max(0, (v.top + panel.clientTop - h.top) / Math.max(host.scrollHeight, h.height)),
      expectedHeight: Math.min(1, panel.clientHeight / Math.max(host.scrollHeight, h.height)),
      scroll: panel.scrollTop, decoded: image.complete && image.naturalWidth > 0 }
  })
}
async function strike(page: Page, plan: PracticePlan, from: number, to: number) {
  await page.evaluate(targets => { for (const notes of targets) {
    for (const pitch of notes) window.midiTest.send([0x90, pitch, 80])
    for (const pitch of notes) window.midiTest.send([0x80, pitch, 0])
  } }, plan.sequence.occurrences.slice(from, to).map(o => o.sourceTarget.expectedMidiNotes))
}

test('short score: single static picture, independent marker, progress/retry and song cleanup', async ({ page }) => {
  await setup(page)
  const initial = await geometry(page); expect(initial.decoded).toBe(true); expect(initial.height).toBeGreaterThan(0.8)
  await button(page, '練習開始').click()
  await page.evaluate(() => { window.midiTest.send([0x90, 60, 80]); window.midiTest.send([0x80, 60, 0]) })
  await expect.poll(async () => (await geometry(page)).moment).not.toBe(initial.moment)
  expect((await geometry(page)).url).toBe(initial.url); expect((await geometry(page)).count).toBe(1)
  await button(page, 'もう一度').click()
  await expect.poll(async () => (await geometry(page)).moment).toBe(initial.moment)
  await page.getByRole('combobox', { name: '練習する曲', exact: true }).selectOption('short-melody')
  await expect(overview(page)).toHaveAttribute('data-state', 'ready')
  await expect.poll(async () => (await geometry(page)).url).not.toBe(initial.url)
  expect((await geometry(page)).count).toBe(1)
  expect(await page.evaluate(() => window.midiTest.requests)).toBe(1)
  // A removed image URL is revoked, not retained across songs.
  expect(await page.evaluate(async url => { try { await fetch(url); return false } catch { return true } }, initial.url)).toBe(true)
})

for (const name of ['maim-maim-full-once', 'maim-maim-full-original']) test(name + ': manual/automatic scroll, frame coalescing, resize and static image', async ({ page }) => {
  await setup(page, name)
  const plan = createPracticePlan(parseFixture(name), 'both')!
  const initial = await geometry(page)
  await page.evaluate(() => {
    const view = document.querySelector<HTMLElement>('.score-view')!
    view.scrollTop = view.scrollHeight * 0.65
    for (let i = 0; i < 100; i++) view.dispatchEvent(new Event('scroll'))
  })
  await expect.poll(async () => (await geometry(page)).top).toBeGreaterThan(0.4)
  const manual = await geometry(page)
  expect(manual.top).toBeCloseTo(manual.expectedTop, 3); expect(manual.height).toBeCloseTo(manual.expectedHeight, 3)
  expect(manual.moment).toBe(initial.moment); expect(manual.markerTransform).toBe(initial.markerTransform)
  expect(manual.updates - initial.updates).toBeLessThan(6)
  await button(page, '現在位置へ戻る').click()
  await expect.poll(async () => (await geometry(page)).top).toBeLessThan(0.05)
  await page.getByRole('combobox', { name: '練習の開始位置' }).selectOption('measure:28')
  await button(page, '練習開始').click()
  await expect.poll(async () => (await geometry(page)).markerTop).toBeGreaterThan(0.7)
  await expect.poll(async () => (await geometry(page)).top).toBeGreaterThan(0.5)
  const beforeResize = await geometry(page)
  await page.setViewportSize({ width: 1024, height: 700 })
  await expect.poll(async () => (await geometry(page)).updates).toBeGreaterThan(beforeResize.updates)
  expect((await geometry(page)).url).toBe(initial.url); expect((await geometry(page)).count).toBe(1)
  expect((await geometry(page)).moment).toBe(plan.sequence.occurrences.find(o => o.sourceMoment.measureIndex === 28)!.sourceMoment.id)
  // Mode changes only move the marker; the overview image never gets regenerated.
  for (const mode of ['right', 'left', 'both'] as const) {
    await button(page, { right: '右手', left: '左手', both: '両手' }[mode]).click()
    const nextPlan = createPracticePlan(parseFixture(name), mode)!
    const index = Number(await page.locator('.practice-controls').getAttribute('data-practice-index'))
    await expect.poll(async () => (await geometry(page)).moment).toBe(nextPlan.sequence.occurrences[index].sourceMoment.id)
  }
  expect((await geometry(page)).url).toBe(initial.url)
  await page.screenshot({ path: `test-results/overview-${name}.png`, fullPage: true })
  await page.locator('.score-card').screenshot({ path: `test-results/overview-${name}-panel.png` })
})

for (const mode of ['right', 'left', 'both'] as const) test(mode + ': practice repeat returns marker/frame to written bar 5 without rendering another score', async ({ page }) => {
  await setup(page, 'maim-maim-full-original', mode)
  const plan = createPracticePlan(parseFixture('maim-maim-full-original'), mode)!
  const first = plan.sequence.occurrences.findIndex(o => o.sourceMoment.measureIndex === 29), second = plan.sequence.occurrences.findIndex(o => o.repeatPass === 2)
  const initial = await geometry(page)
  await page.getByRole('combobox', { name: '練習の開始位置' }).selectOption('measure:29')
  await button(page, '練習開始').click()
  await expect.poll(async () => (await geometry(page)).markerTop).toBeGreaterThan(0.7)
  await strike(page, plan, first, second)
  await expect(page.locator('.repeat-position')).toHaveText('反復 2回目')
  await expect.poll(async () => (await geometry(page)).moment).toBe(plan.sequence.occurrences[second].sourceMoment.id)
  await expect.poll(async () => (await geometry(page)).top).toBeLessThan(0.3)
  expect((await geometry(page)).markerTop).toBeLessThan(0.3)
  expect((await geometry(page)).url).toBe(initial.url); expect((await geometry(page)).count).toBe(1)
  await button(page, 'もう一度').click()
  await expect.poll(async () => (await geometry(page)).moment).toBe(plan.sequence.occurrences[first].sourceMoment.id)
})

for (const mode of ['right', 'left', 'both'] as const) test(mode + ': demo lookahead moves frame before marker, repeat follows audio, fold does not alter MIDI', async ({ page }) => {
  await setup(page, 'maim-maim-full-original', mode)
  const plan = createPracticePlan(parseFixture('maim-maim-full-original'), mode)!, notes = buildDemoPlan(plan, { kind: 'measure', measureIndex: 28 })
  const second = plan.sequence.occurrences.findIndex(o => o.repeatPass === 2)
  const boundary = notes.find(n => n.index === second)!, six = notes.find(n => plan.sequence.occurrences[n.index].repeatPass === 2 && plan.sequence.occurrences[n.index].sourceMoment.measureIndex === 5)!
  const previewAt = Math.max(notes.filter(n => n.index < second).at(-1)!.startMs + 1, boundary.startMs - LOOKAHEAD_MS)
  await page.getByRole('combobox', { name: '手本の開始位置' }).selectOption('measure:28')
  const initial = await geometry(page)
  await page.clock.install(); await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 100)))
  await button(page, '手本を聴く').click(); await page.clock.runFor(20)
  const start = await geometry(page); expect(start.markerTop).toBeGreaterThan(0.7)
  await page.clock.runFor(Math.ceil(previewAt) + 40 - 20)
  const preview = await geometry(page)
  expect(preview.top).toBeLessThan(0.3); expect(preview.markerTop).toBeGreaterThan(0.7)
  await page.clock.runFor(Math.ceil(boundary.startMs) - Math.ceil(previewAt))
  const repeated = await geometry(page)
  expect(repeated.moment).toBe(plan.sequence.occurrences[second].sourceMoment.id); expect(repeated.markerTop).toBeLessThan(0.3)
  await overview(page).locator('summary').click(); expect(await overview(page).getAttribute('open')).toBeNull()
  await page.clock.runFor(Math.ceil(six.startMs - boundary.startMs) + 20)
  await overview(page).locator('summary').click(); await page.clock.runFor(20)
  expect((await geometry(page)).url).toBe(initial.url); expect((await geometry(page)).count).toBe(1)
  await expect(overview(page)).toHaveAttribute('data-written-measures', '30')
  const messages = await page.evaluate(() => window.midiTest.outputMessages), ons = messages.filter(m => m.data[0] === 0x90)
  const anchor = ons[0].timestamp - notes[0].startMs, last = ons.at(-1)!.timestamp - anchor
  const expected = notes.filter(n => n.startMs <= last + 0.01)
  expect(ons.map(m => m.data[1])).toEqual(expected.map(n => n.midiNote))
  for (const [index, on] of ons.entries()) expect(on.timestamp - anchor).toBeCloseTo(expected[index].startMs, 5)
  expect(messages.filter(m => m.data[0] === 0xb0)).toEqual([]); expect(await page.evaluate(() => window.midiTest.outputClears)).toEqual([])
  await test.info().attach('overview-performance', { body: JSON.stringify({ mode, before: initial, after: await geometry(page), noteOnCount: ons.length }, null, 2), contentType: 'application/json' })
  await button(page, '停止').click(); await page.clock.runFor(20)
  await page.locator('.developer-controls > summary').click(); await button(page, '全体表示の診断を更新').click()
  await expect(page.getByRole('region', { name: '全体表示の診断' })).toContainText('Overview render count：1')
})

test('overview generation failure leaves score, practice and demo operational; another song recovers', async ({ page }) => {
  await page.addInitScript(() => {
    const serialize = XMLSerializer.prototype.serializeToString
    let failed = false
    XMLSerializer.prototype.serializeToString = function(node) {
      if (node instanceof SVGSVGElement && !failed) { failed = true; throw new Error('Overview generation failure') }
      return serialize.call(this, node)
    }
  })
  await mockMidi(page); await page.goto('./')
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await expect(overview(page)).toHaveAttribute('data-state', 'error')
  await expect(overview(page)).toContainText('全体表示を作成できませんでした')
  await button(page, 'MIDI接続').click(); await button(page, '練習開始').click()
  await page.evaluate(() => { window.midiTest.send([0x90, 60, 80]); window.midiTest.send([0x80, 60, 0]) })
  await expect(page.locator('.position')).toHaveText('2 / 14 音')
  await button(page, '手本を聴く').click()
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'playing')
  expect(await page.evaluate(() => window.midiTest.outputMessages.filter(m => m.data[0] === 0x90).length)).toBeGreaterThan(0)
  await button(page, '停止').click()
  await page.getByRole('combobox', { name: '練習する曲', exact: true }).selectOption('short-melody')
  await expect(overview(page)).toHaveAttribute('data-state', 'ready')
})

test('a user starting demo before the first overview frame defers generation until playback stops', async ({ page }) => {
  await mockMidi(page)
  await page.clock.install(); await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 100)))
  await page.goto('./'); await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await expect(overview(page)).toHaveAttribute('data-render-count', '0')
  await button(page, 'MIDI接続').click(); await button(page, '手本を聴く').click()
  await page.clock.runFor(700)
  await expect(overview(page)).toHaveAttribute('data-render-count', '0')
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'playing')
  await button(page, '停止').click(); await page.clock.runFor(50)
  await expect(overview(page)).toHaveAttribute('data-state', 'ready')
  await expect(overview(page)).toHaveAttribute('data-render-count', '1')
})

test('scrolling only moves overlays; static SVG serialization and main engraving are untouched', async ({ page }) => {
  await page.addInitScript(() => {
    const serialize = XMLSerializer.prototype.serializeToString
    XMLSerializer.prototype.serializeToString = function(node) {
      if (node instanceof SVGSVGElement) document.body.dataset.overviewSerializations = String(Number(document.body.dataset.overviewSerializations ?? 0) + 1)
      return serialize.call(this, node)
    }
  })
  await setup(page, 'maim-maim-full-original')
  const count = await page.evaluate(() => document.body.dataset.overviewSerializations)
  const snapshot = await page.evaluate(async () => {
    const picture = document.querySelector<HTMLImageElement>('.overview-sheet img')!
    const xml = new DOMParser().parseFromString(await (await fetch(picture.src)).text(), 'image/svg+xml')
    return { pages: xml.querySelectorAll('svg > svg').length, mainPages: document.querySelectorAll('.score-renderer svg').length,
      paths: xml.querySelectorAll('path').length, mainPaths: document.querySelectorAll('.score-renderer path').length, cursors: xml.querySelectorAll('image').length }
  })
  expect(snapshot.pages).toBe(snapshot.mainPages); expect(snapshot.paths).toBe(snapshot.mainPaths); expect(snapshot.cursors).toBe(0)
  await page.evaluate(() => {
    document.body.dataset.engravingMutations = '0'
    new MutationObserver(records => { document.body.dataset.engravingMutations = String(Number(document.body.dataset.engravingMutations) + records.length) })
      .observe(document.querySelector('.score-renderer')!, { subtree: true, childList: true })
  })
  for (const ratio of [0.2, 0.8, 0.5]) {
    await page.evaluate(value => { const view = document.querySelector<HTMLElement>('.score-view')!; view.scrollTop = view.scrollHeight * value }, ratio)
    await expect.poll(async () => (await geometry(page)).top).toBeGreaterThan(ratio - 0.1)
  }
  expect(await page.evaluate(() => document.body.dataset.engravingMutations)).toBe('0')
  expect(await page.evaluate(() => document.body.dataset.overviewSerializations)).toBe(count)
  await button(page, '手本を聴く').click(); await page.waitForTimeout(800); await button(page, '停止').click()
  expect(await page.evaluate(() => document.body.dataset.overviewSerializations)).toBe(count)
  await expect(overview(page)).toHaveAttribute('data-render-count', '1')
})

test('image decode failure is isolated and a stale image completion cannot replace the next song', async ({ page }) => {
  await setup(page)
  const old = await geometry(page)
  await page.evaluate(() => {
    const image = document.querySelector<HTMLImageElement>('.overview-sheet img')!
    const late = image.onload
    document.body.addEventListener('finishOldOverview', () => late?.call(image, new Event('load')))
    image.dispatchEvent(new Event('error'))
  })
  await expect(overview(page)).toHaveAttribute('data-state', 'error')
  await expect(page.locator('.score-renderer svg')).toBeVisible()
  await page.getByRole('combobox', { name: '練習する曲', exact: true }).selectOption('do-re-mi')
  await expect(overview(page)).toHaveAttribute('data-state', 'ready')
  const current = await geometry(page)
  expect(current.url).not.toBe(old.url)
  await page.evaluate(() => document.body.dispatchEvent(new Event('finishOldOverview')))
  expect((await geometry(page)).url).toBe(current.url)
  await expect(overview(page)).toHaveAttribute('data-state', 'ready')
})
