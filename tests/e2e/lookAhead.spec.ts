import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockMidi } from './midiFixture'
import { fixture, parseFixture } from '../unit/xmlFixture'
import { createPracticePlan } from '../../src/practice/PracticePlan'
import type { PracticeMode, PracticePlan } from '../../src/practice/PracticePlan'
import { buildDemoPlan } from '../../src/audio/buildDemoPlan'
import { LOOKAHEAD_MS } from '../../src/audio/DemoLookAhead'

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const labels = { right: '右手', left: '左手', both: '両手' }
async function setup(page: Page, name: string, mode: PracticeMode) {
  await page.setViewportSize({ width: 1366, height: 768 }); await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockMidi(page); await page.goto('./'); await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await button(page, 'MIDI接続').click()
  await page.locator('input[type=file]').setInputFiles({ name: name + '.musicxml', mimeType: 'application/xml', buffer: Buffer.from(fixture(name)) })
  await page.getByRole('form', { name: '曲の登録確認' }).getByRole('button', { name: '追加する', exact: true }).click()
  await page.locator('.personal-song-list > li').getByRole('button', { name: '選択', exact: true }).click()
  const plan = createPracticePlan(parseFixture(name), mode)!
  await button(page, labels[mode]).click()
  await expect(page.locator('.position')).toHaveText('1 / ' + plan.sequence.occurrences.length + ' ステップ')
  return plan
}
async function strike(page: Page, plan: PracticePlan, from: number, to: number) {
  await page.evaluate(targets => { for (const target of targets) {
    for (const pitch of target) window.midiTest.send([0x90, pitch, 80])
    for (const pitch of target) window.midiTest.send([0x80, pitch, 0])
  } }, plan.sequence.occurrences.slice(from, to).map(o => o.sourceTarget.expectedMidiNotes))
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-index', String(to))
}
async function geometry(page: Page, noteIds: readonly string[] = []) {
  return page.evaluate(ids => {
    const view = document.querySelector('.score-view') as HTMLElement, cursor = document.querySelector('.score-renderer img') as HTMLElement
    const v = view.getBoundingClientRect(), c = cursor.getBoundingClientRect(), h = document.querySelector('.score-status')!.getBoundingClientRect()
    const top = Math.max(v.top, h.bottom, 0), bottom = Math.min(v.bottom, innerHeight)
    const heads = [...document.querySelectorAll<HTMLElement>('[data-score-notes]')].filter(el => el.dataset.scoreNotes!.split(' ').some(id => ids.includes(id))).map(el => el.getBoundingClientRect())
    return { scroll: view.scrollTop, currentVisible: c.top >= top - 1 && c.bottom <= bottom + 1,
      nextVisible: heads.length > 0 && heads.every(rect => rect.top >= top - 1 && rect.bottom <= bottom + 1),
      cursorTop: c.top, cursorLeft: c.left, cursorHeight: c.height, current: view.dataset.currentSystem,
      preview: view.dataset.lookaheadMoment, nextSystem: view.dataset.lookaheadSystem, behavior: view.dataset.lastBehavior,
      headerVisible: h.top >= 0 && h.bottom <= innerHeight }
  }, noteIds)
}
async function findPreview(page: Page, plan: PracticePlan, first = 0) {
  for (let index = first; index < Math.min(first + 40, plan.sequence.occurrences.length - 1); index++) {
    const state = await geometry(page)
    if (state.preview) return { state, index, next: plan.sequence.occurrences.findIndex((o, i) => i > index && o.sourceMoment.id === state.preview) }
    await strike(page, plan, index, index + 1)
  }
  throw new Error('No system preview before next-system input')
}
async function clock(page: Page) { await page.clock.install(); await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 100))) }
async function recordScroll(page: Page) {
  await page.evaluate(() => {
    const view = document.querySelector('.score-view') as HTMLElement, scroll = view.scrollTo.bind(view)
    view.scrollTo = ((options: ScrollToOptions) => { view.dataset.lastBehavior = options.behavior; scroll(options) }) as typeof view.scrollTo
  })
}

for (const name of ['j-long-practice', 'maim-maim-full-once', 'maim-maim-full-original']) for (const mode of ['right', 'left', 'both'] as const) {
  test(name + ' ' + mode + ': current and next system are visible BEFORE input; manual browsing, return and partial start', async ({ page }) => {
    const plan = await setup(page, name, mode)
    await button(page, '練習開始').click()
    const { index, next, state } = await findPreview(page, plan)
    expect(next).toBeGreaterThan(index); expect(state.current).not.toBe(state.nextSystem)
    const nextIds = plan.score.notes.filter(n => n.measureIndex === plan.sequence.occurrences[next].sourceMoment.measureIndex && !n.tieStop).map(n => n.id)
    await expect.poll(async () => (await geometry(page, nextIds)).nextVisible).toBe(true)
    expect((await geometry(page)).currentVisible).toBe(true)
    expect((await geometry(page)).headerVisible).toBe(true)
    await expect(page.locator('.current-measure')).toHaveText(plan.sequence.occurrences[index].sourceMoment.measureNumber + '小節目')
    // An incorrect note must not advance the cursor or repeatedly force a preview.
    const before = await geometry(page)
    await page.evaluate(() => { window.midiTest.send([0x90, 127, 80]); window.midiTest.send([0x80, 127, 0]) })
    await expect(page.locator('.practice-feedback')).toHaveText('もう一度♪')
    expect((await geometry(page)).scroll).toBe(before.scroll)
    await page.evaluate(() => document.querySelector('.score-view')!.scrollTo({ top: 10000, behavior: 'instant' }))
    const manual = (await geometry(page)).scroll
    await page.waitForTimeout(300); expect((await geometry(page)).scroll).toBe(manual)
    await button(page, '現在位置へ戻る').click()
    expect((await geometry(page)).currentVisible).toBe(true)
    expect((await geometry(page)).preview).toBe('')
    // A selected last measure must prepare its next system on start, without an initial strike.
    const source = plan.sequence.occurrences[index].sourceMoment
    await page.getByRole('combobox', { name: '練習の開始位置', exact: true }).selectOption('measure:' + source.measureIndex)
    await button(page, '練習開始').click()
    await expect(page.locator('.score-view')).toHaveAttribute('data-lookahead-moment', plan.sequence.occurrences[next].sourceMoment.id)
    await expect.poll(async () => (await geometry(page, nextIds)).nextVisible).toBe(true)
    expect((await geometry(page)).currentVisible).toBe(true)
    if (name === 'maim-maim-full-original') {
      const second = plan.sequence.occurrences.findIndex(o => o.repeatPass === 2)
      const first = plan.sequence.occurrences.findIndex(o => o.sourceMoment.measureIndex === source.measureIndex)
      await strike(page, plan, first, second - 1)
      const lastScroll = (await geometry(page)).scroll
      await recordScroll(page); await page.emulateMedia({ reducedMotion: 'no-preference' })
      const immediate = await page.evaluate(pitches => {
        for (const p of pitches) window.midiTest.send([0x90, p, 80])
        // Inspect synchronously in the very same MIDI handler turn, before Note Off / next Note On.
        const view = document.querySelector('.score-view') as HTMLElement, c = document.querySelector('.score-renderer img')!.getBoundingClientRect(), v = view.getBoundingClientRect()
        const result = { measure: document.querySelector('.current-measure')!.textContent, visible: c.top >= v.top && c.bottom <= Math.min(v.bottom, innerHeight),
          behavior: view.dataset.lastBehavior, scroll: view.scrollTop }
        for (const p of pitches) window.midiTest.send([0x80, p, 0])
        return result
      }, plan.sequence.occurrences[second - 1].sourceTarget.expectedMidiNotes)
      expect(immediate.measure).toBe('5小節目'); expect(immediate.visible).toBe(true)
      expect(immediate.behavior).toBe('instant'); expect(immediate.scroll).toBeLessThan(lastScroll)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const again = await findPreview(page, plan, second)
      expect(again.next).toBeGreaterThan(again.index)
      expect(plan.sequence.occurrences[again.next].repeatPass).toBe(2)
      const ids = plan.score.notes.filter(n => n.measureIndex === plan.sequence.occurrences[again.next].sourceMoment.measureIndex && !n.tieStop).map(n => n.id)
      expect((await geometry(page, ids)).nextVisible).toBe(true)
      if (mode === 'both') await page.screenshot({ path: 'test-results/phase2ed33-practice.png' })
    }
    expect(await page.evaluate(() => window.midiTest.inputListenerCount())).toBe(1)
  })
}

for (const mode of ['right', 'left', 'both'] as const) test('original ' + mode + ': repeat viewport moves before destination MIDI, cursor stays actual, stop restores current', async ({ page }) => {
  const plan = await setup(page, 'maim-maim-full-original', mode), occurrences = plan.sequence.occurrences
  const second = occurrences.findIndex(o => o.repeatPass === 2)
  await page.getByRole('combobox', { name: '練習の開始位置', exact: true }).selectOption('measure:9')
  await button(page, '練習開始').click()
  const practicePosition = await page.locator('.position').innerText()
  await page.getByRole('combobox', { name: '手本の開始位置' }).selectOption('measure:29')
  await clock(page); await recordScroll(page); await page.emulateMedia({ reducedMotion: 'no-preference' })
  const notes = buildDemoPlan(plan, { kind: 'measure', measureIndex: 29 })
  const jump = notes.find(n => n.index === second)!, last = notes.filter(n => n.index < second).at(-1)!
  const previewAt = Math.max(last.startMs + 1, jump.startMs - LOOKAHEAD_MS)
  await button(page, '手本を聴く').click()
  await page.clock.runFor(Math.ceil(previewAt) + 1)
  await expect(page.locator('.current-measure')).toHaveText('30小節目')
  await expect(page.locator('.score-view')).toHaveAttribute('data-navigation-jump', 'true')
  expect((await geometry(page)).behavior).toBe('instant')
  const ids = occurrences[second].sourceTarget.sourceNotes.filter(n => !n.tieStop).map(n => n.id)
  expect((await geometry(page, ids)).nextVisible).toBe(true)
  expect((await geometry(page)).currentVisible).toBe(false)
  expect(await page.evaluate(() => window.midiTest.outputMessages.filter(m => m.data[0] === 0x90).length)).toBe(notes.filter(n => n.index < second).length)
  if (mode === 'both') await page.screenshot({ path: 'test-results/phase2ed33-demo-repeat-preview.png' })
  // User may explicitly return to the sounding note, without preview immediately overriding it.
  await button(page, '現在位置へ戻る').click()
  expect((await geometry(page)).currentVisible).toBe(true)
  const returned = (await geometry(page)).scroll
  await page.clock.runFor(20); expect((await geometry(page)).scroll).toBe(returned)
  // At the actual boundary, even this override is resolved before the Note On call.
  await page.evaluate(() => {
    const messages = window.midiTest.outputMessages, push = messages.push.bind(messages)
    messages.push = (...items) => {
      if (items.some(m => m.data[0] === 0x90)) {
        const c = document.querySelector('.score-renderer img')!.getBoundingClientRect(), v = document.querySelector('.score-view')!.getBoundingClientRect()
        document.body.dataset.jumpMidiVisible = String(c.top >= v.top && c.bottom <= Math.min(v.bottom, innerHeight))
        document.body.dataset.jumpMidiMeasure = document.querySelector('.current-measure')!.textContent!
      }
      return push(...items)
    }
  })
  await page.clock.runFor(Math.ceil(jump.startMs) - Math.ceil(previewAt) - 20)
  expect(await page.evaluate(() => document.body.dataset.jumpMidiVisible)).toBe('true')
  expect(await page.evaluate(() => document.body.dataset.jumpMidiMeasure)).toBe('5小節目')
  const ons = await page.evaluate(() => window.midiTest.outputMessages.filter(m => m.data[0] === 0x90))
  for (let i = 0; i < ons.length; i++) expect(ons[i].timestamp - ons[0].timestamp).toBeCloseTo(notes[i].startMs - notes[0].startMs, 5)
  await button(page, '停止').click()
  await expect(page.locator('.position')).toHaveText(practicePosition)
  expect((await geometry(page)).currentVisible).toBe(true)
  const stopped = (await geometry(page)).scroll, count = await page.evaluate(() => window.midiTest.outputMessages.length)
  await page.clock.runFor(120000)
  expect((await geometry(page)).scroll).toBe(stopped)
  expect(await page.evaluate(() => window.midiTest.outputMessages.length)).toBe(count)
})

for (const name of ['j-long-practice', 'maim-maim-full-once']) test(name + ': partial demo previews adjacent systems before first next-system attack', async ({ page }) => {
  const plan = await setup(page, name, 'both')
  await button(page, '練習開始').click()
  const { index, next } = await findPreview(page, plan)
  const ids = plan.sequence.occurrences[next].sourceTarget.sourceNotes.filter(n => !n.tieStop).map(n => n.id)
  await page.getByRole('combobox', { name: '手本の開始位置' }).selectOption('current')
  await clock(page)
  const notes = buildDemoPlan(plan, { kind: 'occurrence', occurrenceId: plan.sequence.occurrences[index].id })
  const boundary = notes.find(n => n.index === next)!
  await button(page, '手本を聴く').click()
  await page.clock.runFor(Math.ceil(Math.max(1, boundary.startMs - LOOKAHEAD_MS)) + 1)
  await expect(page.locator('.score-view')).toHaveAttribute('data-lookahead-moment', plan.sequence.occurrences[next].sourceMoment.id)
  const state = await geometry(page, ids)
  expect(state.nextVisible).toBe(true); expect(state.currentVisible).toBe(true)
  expect(Number((await page.locator('.position').innerText()).split(' / ')[0])).toBeLessThan(next + 1)
  // A height/width change recalculates system geometry and keeps the real cursor.
  await page.setViewportSize({ width: 1280, height: 800 }); await page.clock.runFor(50)
  expect((await geometry(page)).currentVisible).toBe(true)
  await page.clock.runFor(Math.ceil(boundary.startMs) - Math.ceil(Math.max(1, boundary.startMs - LOOKAHEAD_MS)) - 50)
  await expect(page.locator('.current-measure')).toHaveText(plan.sequence.occurrences[next].sourceMoment.measureNumber + '小節目')
  await button(page, '停止').click()
  expect((await geometry(page)).currentVisible).toBe(true)
})

test('batched MIDI delivery still commits the repeat destination before the next input handler', async ({ page }) => {
  const plan = await setup(page, 'maim-maim-full-original', 'both')
  await button(page, '練習開始').click(); await recordScroll(page)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const second = plan.sequence.occurrences.findIndex(o => o.repeatPass === 2)
  const immediate = await page.evaluate(targets => {
    for (const pitches of targets) {
      for (const p of pitches) window.midiTest.send([0x90, p, 80])
      for (const p of pitches) window.midiTest.send([0x80, p, 0])
    }
    const v = document.querySelector('.score-view') as HTMLElement, box = v.getBoundingClientRect(), c = document.querySelector('.score-renderer img')!.getBoundingClientRect()
    return { measure: document.querySelector('.current-measure')!.textContent, behavior: v.dataset.lastBehavior, visible: c.top >= box.top && c.bottom <= Math.min(box.bottom, innerHeight) }
  }, plan.sequence.occurrences.slice(0, second).map(o => o.sourceTarget.expectedMidiNotes))
  expect(immediate).toEqual({ measure: '5小節目', behavior: 'instant', visible: true })
})
