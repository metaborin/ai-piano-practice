import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockMidi } from './midiFixture'
import { fixture, parseFixture } from '../unit/xmlFixture'
import { createPracticePlan } from '../../src/practice/PracticePlan'
import { buildDemoPlan } from '../../src/audio/buildDemoPlan'
import type { PracticeMode } from '../../src/practice/PracticePlan'

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
async function setup(page: Page, mode: PracticeMode, measure: number) {
  await page.setViewportSize({ width: 1366, height: 768 }); await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockMidi(page); await page.goto('./'); await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await button(page, 'MIDI接続').click()
  await page.locator('.song-import input[type=file]').setInputFiles({ name: 'original.musicxml', mimeType: 'application/xml', buffer: Buffer.from(fixture('maim-maim-full-original')) })
  await page.getByRole('form', { name: '曲の登録確認' }).getByRole('button', { name: '追加する', exact: true }).click()
  await page.locator('.personal-song-list > li').getByRole('button', { name: '選択', exact: true }).click()
  await expect(page.locator('.position')).toHaveText('1 / 204 ステップ')
  await button(page, { right: '右手', left: '左手', both: '両手' }[mode]).click()
  await page.getByRole('combobox', { name: '手本の開始位置' }).selectOption('measure:' + (measure - 1))
}

for (const mode of ['right', 'left', 'both'] as const) test(mode + ': real-clock repeat cursor cost cannot lose any pass-2 bar-5 attacks', async ({ page }) => {
  const plan = createPracticePlan(parseFixture('maim-maim-full-original'), mode)!, notes = buildDemoPlan(plan, { kind: 'measure', measureIndex: 29 })
  const second = plan.sequence.occurrences.find(o => o.repeatPass === 2)!.sequenceIndex
  const six = notes.find(n => plan.sequence.occurrences[n.index].repeatPass === 2 && plan.sequence.occurrences[n.index].sourceMoment.measureNumber === '6')!
  await setup(page, mode, 30)
  // OSMD's visible cursor.update writes image.width once per position. Model a
  // slower device at the ACTUAL backwards traversal, without slowing timers.
  await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'width')!
    document.body.dataset.repeatCursorWrites = '0'
    Object.defineProperty(HTMLImageElement.prototype, 'width', { ...descriptor, set(value) {
      if (this.closest('.score-renderer') && document.querySelector('.demo-controls')?.getAttribute('data-demo-status') === 'playing'
        && document.querySelector('.repeat-position')?.textContent === '反復 2回目' && document.querySelector('.current-measure')?.textContent === '5小節目') {
        document.body.dataset.repeatCursorWrites = String(Number(document.body.dataset.repeatCursorWrites) + 1)
        const until = performance.now() + 3
        while (performance.now() < until) { /* cost per visible cursor DOM update */ }
      }
      descriptor.set!.call(this, value)
    } })
  })
  await button(page, '手本を聴く').click()
  await page.waitForTimeout(six.startMs + 150)
  const messages = await page.evaluate(() => window.midiTest.outputMessages)
  const expected = notes.filter(n => n.startMs < six.startMs)
  const ons = messages.filter(m => m.data[0] === 0x90)
  const anchor = ons[0].timestamp - notes[0].startMs
  const actual = ons.filter(m => m.timestamp - anchor < six.startMs - 0.01)
  const audit = { mode, second, expected: expected.map(n => ({ ...n, measure: plan.sequence.occurrences[n.index].sourceMoment.measureNumber, pass: plan.sequence.occurrences[n.index].repeatPass })),
    actual: messages, cursorWrites: await page.evaluate(() => document.body.dataset.repeatCursorWrites), clears: await page.evaluate(() => window.midiTest.outputClears), diagnostics: await page.locator('.demo-diagnostics').textContent() }
  await test.info().attach('repeat-midi-audit', { body: JSON.stringify(audit, null, 2), contentType: 'application/json' })
  expect(actual.map(m => m.data[1])).toEqual(expected.map(n => n.midiNote))
  expect(Number(audit.cursorWrites)).toBeLessThan(8)
  expect(audit.diagnostics).toContain('Expired attacks：0')
  expect(await page.evaluate(() => window.midiTest.outputClears)).toEqual([])
  expect(messages.filter(m => m.data[0] === 0xb0)).toEqual([])
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'playing')
  await button(page, '停止').click()
})

for (const mode of ['right', 'left', 'both'] as const) for (const measure of [29, 30]) test(mode + ': timestamp audit ' + measure + '→30→5 pass2→6 and local MIDI trace', async ({ page }) => {
  const plan = createPracticePlan(parseFixture('maim-maim-full-original'), mode)!, notes = buildDemoPlan(plan, { kind: 'measure', measureIndex: measure - 1 })
  await setup(page, mode, measure)
  await page.clock.install(); await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 100)))
  await button(page, '手本を聴く').click()
  const six = notes.find(n => plan.sequence.occurrences[n.index].repeatPass === 2 && plan.sequence.occurrences[n.index].sourceMoment.measureNumber === '6')!
  await page.clock.runFor(Math.ceil(six.startMs) + 1)
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'playing')
  await expect(page.locator('.current-measure')).toHaveText('6小節目')
  const sent = await page.evaluate(() => window.midiTest.outputMessages), ons = sent.filter(m => m.data[0] === 0x90)
  const expected = notes.filter(n => n.startMs <= six.startMs), anchor = ons[0].timestamp - notes[0].startMs
  expect(ons.map(m => m.data[1])).toEqual(expected.map(n => n.midiNote))
  for (const [i, on] of ons.entries()) {
    expect(on.timestamp - anchor).toBeCloseTo(expected[i].startMs, 5)
    expect(on.requestedAt - on.timestamp).toBeLessThan(2)
    const off = sent.find(m => m.data[0] === 0x80 && m.data[1] === on.data[1] && Math.abs(m.timestamp - anchor - expected[i].noteOffMs) < 0.01)
    expect(off).toBeDefined()
  }
  expect(sent.filter(m => m.data[0] === 0xb0)).toEqual([])
  expect(await page.evaluate(() => window.midiTest.outputClears)).toEqual([])
  await page.locator('.developer-controls > summary').click(); await button(page, 'ログを更新').click()
  const trace = await page.getByRole('textbox', { name: 'Demo MIDI Traceの記録' }).inputValue()
  expect(trace).toContain('REPEAT_JUMP'); expect(trace).toMatch(/NOTE_ON[^\n]+measure=5 pass=2/)
  expect(trace.slice(trace.lastIndexOf(' START '))).not.toMatch(/CLEAR|ALL_NOTES_OFF|GENERATION_CHANGE|SKIP/)
  await button(page, '停止').click(); await button(page, 'ログを更新').click()
  expect(await page.getByRole('textbox', { name: 'Demo MIDI Traceの記録' }).inputValue()).toContain('ALL_NOTES_OFF')
  const stopped = await page.evaluate(() => window.midiTest.outputMessages)
  await page.clock.runFor(120000)
  expect(await page.evaluate(() => window.midiTest.outputMessages)).toEqual(stopped)
})
