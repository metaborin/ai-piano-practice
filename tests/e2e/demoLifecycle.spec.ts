import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockMidi } from './midiFixture'
import { fixture, parseFixture } from '../unit/xmlFixture'
import { createPracticePlan } from '../../src/practice/PracticePlan'
import type { PracticeMode } from '../../src/practice/PracticePlan'
import { buildDemoPlan } from '../../src/audio/buildDemoPlan'

const plan = createPracticePlan(parseFixture('maim-maim-full-original'))!
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
async function setup(page: Page, mode: PracticeMode = 'both') {
  await page.setViewportSize({ width: 1366, height: 768 }); await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockMidi(page); await page.goto('./'); await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await button(page, 'MIDI接続').click()
  await page.locator('.song-import input[type=file]').setInputFiles({ name: 'original.musicxml', mimeType: 'application/xml', buffer: Buffer.from(fixture('maim-maim-full-original')) })
  await page.getByRole('form', { name: '曲の登録確認' }).getByRole('button', { name: '追加する', exact: true }).click()
  await page.locator('.personal-song-list > li').getByRole('button', { name: '選択', exact: true }).click()
  await expect(page.locator('.position')).toHaveText('1 / 204 ステップ')
  await button(page, { right: '右手', left: '左手', both: '両手' }[mode]).click()
}

for (const completed of [false, true]) test('no full score redraw during demo on ' + (completed ? 'restart after practice completion' : 'first forward-repeat entry'), async ({ page }) => {
  await setup(page)
  if (completed) {
    await button(page, '練習開始').click()
    await page.evaluate(targets => { for (const pitches of targets) {
      for (const p of pitches) window.midiTest.send([0x90, p, 80])
      for (const p of pitches) window.midiTest.send([0x80, p, 0])
    } }, plan.sequence.occurrences.map(o => o.sourceTarget.expectedMidiNotes))
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status', 'completed')
  }
  // Real clock: model a slower device only when OSMD actually replaces the SVG.
  // Virtual timer tests previously hid the cost of a full-score redraw.
  await page.waitForTimeout(250)
  await page.evaluate(() => {
    const host = document.querySelector('.score-renderer')!
    let svg = host.querySelector('svg')
    document.body.dataset.demoRedraws = '[]'
    new MutationObserver(() => {
      const next = host.querySelector('svg')
      if (svg === next) return
      svg = next
      if (document.querySelector('.demo-controls')?.getAttribute('data-demo-status') !== 'playing') return
      const measure = document.querySelector('.current-measure')?.textContent
      const events = JSON.parse(document.body.dataset.demoRedraws!)
      events.push({ measure, at: performance.now() }); document.body.dataset.demoRedraws = JSON.stringify(events)
      const until = performance.now() + 500
      while (performance.now() < until) { /* simulate the cost of rendering on a slower Chromebook */ }
    }).observe(host, { childList: true, subtree: true })
  })
  await button(page, '手本を聴く').click()
  const notes = buildDemoPlan(plan), six = notes.find(n => plan.sequence.occurrences[n.index].sourceMoment.measureNumber === '6')!
  await page.waitForTimeout(six.startMs + 250)
  const redraws = await page.evaluate(() => document.body.dataset.demoRedraws)
  await test.info().attach('demo-render-audit', { body: JSON.stringify({ completed, redraws, status: await page.locator('.demo-controls').getAttribute('data-demo-status'), message: await page.locator('.demo-message').innerText() }), contentType: 'application/json' })
  expect(redraws).toBe('[]')
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'playing')
  await button(page, '停止').click()
})

for (const mode of ['right', 'left', 'both'] as const) test('original ' + mode + ': A–F lifecycle, full repeat order, replay, and completed-current fallback', async ({ page }) => {
  test.setTimeout(120000)
  const selected = createPracticePlan(parseFixture('maim-maim-full-original'), mode)!, occurrences = selected.sequence.occurrences, notes = buildDemoPlan(selected)
  await setup(page, mode)
  await page.clock.install(); await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 100)))
  const choice = page.getByRole('combobox', { name: '手本の開始位置' }), status = page.locator('.demo-controls')
  const ons = () => page.evaluate(() => window.midiTest.outputMessages.filter(m => m.data[0] === 0x90))
  const start = async (current = false) => {
    await choice.selectOption(current ? 'current' : 'beginning')
    await page.evaluate(() => window.midiTest.outputMessages = [])
    await button(page, '手本を聴く').click()
    await expect(status).toHaveAttribute('data-demo-status', 'playing')
    await expect(page.locator('.position')).toHaveText('1 / ' + occurrences.length + ' ステップ')
    expect((await ons()).map(m => m.data[1])).toEqual(notes.filter(n => n.startMs === 0).map(n => n.midiNote))
  }
  const pastFive = async () => {
    const six = notes.find(n => occurrences[n.index].sourceMoment.measureNumber === '6')!
    await page.clock.runFor(Math.ceil(six.startMs) + 1)
    await expect(status).toHaveAttribute('data-demo-status', 'playing')
    await expect(page.locator('.current-measure')).toHaveText('6小節目')
    await button(page, '停止').click()
  }
  const complete = async () => {
    await page.clock.runFor(120000)
    await expect(status).toHaveAttribute('data-demo-status', 'completed')
    const messages = await ons()
    expect(messages.map(m => m.data[1])).toEqual(notes.map(n => n.midiNote))
    messages.forEach((m, i) => expect(m.timestamp - messages[0].timestamp).toBeCloseTo(notes[i].startMs - notes[0].startMs, 5))
    await expect(page.locator('.demo-diagnostics')).toContainText('Scheduled timers：0 ／ Active output notes：[]')
  }
  // A: fresh beginning, inspect each boundary before final Off.
  await start()
  let elapsed = 0
  for (const [measure, pass] of [['5', 1], ['30', 1], ['5', 2], ['30', 2]] as const) {
    const target = occurrences.find(o => o.sourceMoment.measureNumber === measure && o.repeatPass === pass)!
    const at = Math.ceil(notes.find(n => n.index === target.sequenceIndex)!.startMs) + 1
    await page.clock.runFor(at - elapsed); elapsed = at
    await expect(status).toHaveAttribute('data-demo-status', 'playing')
    await expect(page.locator('.current-measure')).toHaveText(measure + '小節目')
    await expect(page.locator('.repeat-position')).toHaveText('反復 ' + pass + '回目')
  }
  await complete()
  // F: completed demo -> beginning again.
  await start(); await complete()
  // B: practice in progress -> beginning (practice is suspended by demo).
  await button(page, '練習開始').click()
  const press = async (from: number) => page.evaluate(targets => { for (const pitches of targets) {
    for (const p of pitches) window.midiTest.send([0x90, p, 80])
    for (const p of pitches) window.midiTest.send([0x80, p, 0])
  } }, occurrences.slice(from, from === 0 ? 3 : undefined).map(o => o.sourceTarget.expectedMidiNotes))
  await press(0); await start(); await pastFive()
  // E: interrupted demo -> beginning again.
  await start(); await pastFive()
  // C: practice completed -> beginning.
  await press(3)
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status', 'completed')
  await start(); await pastFive()
  // D: completed current -> explicit fallback, also complete the whole sequence.
  await start(true)
  await expect(page.locator('.demo-message')).toContainText('練習が最後まで終わっているため、最初から手本を再生します')
  await complete()
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status', 'completed')
})

test('scroll failure cannot clear MIDI or stop the original demo', async ({ page }) => {
  await setup(page)
  await page.clock.install(); await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 100)))
  await page.evaluate(() => {
    const view = document.querySelector('.score-view') as HTMLElement
    view.scrollTo = (() => { throw new Error('scroll failed') }) as typeof view.scrollTo
  })
  const before = await page.evaluate(() => window.midiTest.outputClears.length)
  await button(page, '手本を聴く').click()
  await page.clock.runFor(6500)
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'playing')
  expect(await page.evaluate(() => window.midiTest.outputClears.length)).toBe(before)
  await expect(page.getByText('楽譜の追従を更新できませんでした。手本の音は続きます。停止後に曲を選び直してください。')).toBeVisible()
  await button(page, '停止').click()
  const count = await page.evaluate(() => window.midiTest.outputMessages.length)
  await page.clock.runFor(120000)
  expect(await page.evaluate(() => window.midiTest.outputMessages.length)).toBe(count)
})
