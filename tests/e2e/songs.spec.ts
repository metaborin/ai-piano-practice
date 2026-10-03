import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import { mockMidi } from './midiFixture'

const catalog = [
  { id: 'twinkle-opening', file: 'twinkle', title: 'きらきら星', count: 14, first: 60 },
  { id: 'do-re-mi', file: 'do-re-mi', title: 'ドレミの練習', count: 7, first: 60 },
  { id: 'short-melody', file: 'short-melody', title: '短いメロディ', count: 5, first: 67 },
]
const select = (page: Page, id: string) => page.getByRole('combobox', { name: '練習する曲' }).selectOption(id)
async function setup(page: Page) {
  await mockMidi(page)
  await page.goto('./')
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await page.getByRole('button', { name: 'MIDI接続', exact: true }).click()
  await expect(page.getByRole('button', { name: '手本を聴く' })).toBeEnabled()
}
async function strike(page: Page, note: number, id = 'cme') {
  await page.evaluate(({ note, id }) => {
    window.midiTest.send([0x90, note, 80], id)
    window.midiTest.send([0x80, note, 0], id)
  }, { note, id })
}
async function assertIdle(page: Page, count: number) {
  await expect(page.locator('.position')).toHaveText('1 / ' + count + ' 音')
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status', 'idle')
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', '0')
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'idle')
  await expect(page.locator('.score-renderer img')).toBeVisible()
}

for (const song of catalog) {
  test(song.title + ': XML, rendered targets, grading, completion, restart and demo agree', async ({ page }) => {
    await setup(page)
    if (song.id !== catalog[0].id) await select(page, song.id)
    await assertIdle(page, song.count)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(song.title)
    await expect(page.getByRole('img', { name: song.title + 'の楽譜' })).toBeVisible()
    await expect(page.locator('.score-renderer .vf-stavenote')).toHaveCount(song.count)
    // Independent XML oracle: never get the expected sequence from the app's model.
    const xml = readFileSync(new URL('../../src/scores/' + song.file + '.musicxml', import.meta.url), 'utf8')
    const notes = await page.evaluate((xml) => {
      const doc = new DOMParser().parseFromString(xml, 'application/xml')
      const offsets: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
      return [...doc.querySelectorAll('note')].map((note) => ({
        pitch: (Number(note.querySelector('octave')!.textContent) + 1) * 12 + offsets[note.querySelector('step')!.textContent!],
        beats: Number(note.querySelector('duration')!.textContent),
      }))
    }, xml)
    expect(notes).toHaveLength(song.count)
    expect(notes[0].pitch).toBe(song.first)
    await page.getByRole('button', { name: '練習開始', exact: true }).click()
    await strike(page, song.first + 1)
    await expect(page.locator('.practice-feedback')).toHaveText('もう一度♪')
    await expect(page.locator('.position')).toHaveText('1 / ' + song.count + ' 音')
    for (let index = 0; index < notes.length; index++) {
      await strike(page, notes[index].pitch)
      await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', String(index + 1))
    }
    await expect(page.locator('.practice-feedback')).toHaveText('できました！')
    await expect(page.locator('.position')).toHaveText(song.count + ' / ' + song.count + ' 音')
    await page.getByRole('button', { name: 'もう一度', exact: true }).click()
    await expect(page.locator('.position')).toHaveText('1 / ' + song.count + ' 音')
    await strike(page, song.first)
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', '1')
    await page.evaluate(() => { window.midiTest.loopback = true })
    // Freeze each target while reading both progress and cursor; wall-time reads can
    // straddle a note boundary on a busy machine and compare different instants.
    await page.clock.install()
    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 100)))
    await page.getByRole('button', { name: '手本を聴く' }).click()
    let previousCursor = ''
    for (let index = 0; index < notes.length; index++) {
      await expect(page.locator('.position')).toHaveText((index + 1) + ' / ' + song.count + ' 音')
      const cursor = await page.locator('.score-renderer img').evaluate((element) => {
        const image = element as HTMLImageElement
        return image.offsetLeft + ':' + image.offsetTop
      })
      expect(cursor).not.toBe(previousCursor)
      previousCursor = cursor
      await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', '1')
      await page.clock.runFor(notes[index].beats * 600)
    }
    await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'completed')
    await expect(page.locator('.position')).toHaveText('2 / ' + song.count + ' 音')
    const sent = await page.evaluate(() => window.midiTest.outputMessages)
    const ons = sent.filter((event) => event.data[0] === 0x90)
    const offs = sent.filter((event) => event.data[0] === 0x80)
    expect(ons.map((event) => event.data[1])).toEqual(notes.map((note) => note.pitch))
    for (let index = 0; index < notes.length; index++) {
      expect(offs[index].timestamp - ons[index].timestamp).toBeCloseTo(notes[index].beats * 600 * 0.9, 2)
    }
  })
}

test('repeated selection resets practice/completion and preserves explicit MIDI ports and a single handler', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => {
    window.midiTest.setConnected('other', true)
    window.midiTest.setOutputConnected('other-out', true)
  })
  await page.getByRole('combobox', { name: '入力機器' }).selectOption('other')
  await page.getByRole('combobox', { name: '出力機器' }).selectOption('other-out')
  for (const song of [catalog[2], catalog[1], catalog[2], catalog[0]]) {
    await select(page, song.id)
    await assertIdle(page, song.count)
    await expect(page.getByRole('combobox', { name: '入力機器' })).toHaveValue('other')
    await expect(page.getByRole('combobox', { name: '出力機器' })).toHaveValue('other-out')
    await strike(page, song.first, 'other')
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', '0')
    await page.getByRole('button', { name: '練習開始', exact: true }).click()
    await strike(page, song.first, 'other')
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', '1')
  }
  // Finish the short song, then switch away from a completed session.
  await select(page, catalog[2].id)
  await assertIdle(page, 5)
  await page.getByRole('button', { name: '練習開始', exact: true }).click()
  for (const note of [67, 64, 65, 62, 67]) await strike(page, note, 'other')
  await expect(page.locator('.practice-feedback')).toHaveText('できました！')
  await select(page, catalog[0].id)
  await assertIdle(page, 14)
  await expect(page.locator('.practice-feedback')).not.toHaveText('できました！')
  expect(await page.evaluate(() => window.midiTest.requests)).toBe(1)
  expect(await page.evaluate(() => window.midiTest.inputListenerCount())).toBe(1)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.getByRole('combobox', { name: '練習する曲' })).toBeVisible()
  await page.screenshot({ path: 'test-results/phase2d-mobile.png', fullPage: true })
})

test('switching during demo and C4 test stops output, reservations and old cursor updates', async ({ page }) => {
  await setup(page)
  await page.clock.install()
  await page.getByRole('button', { name: '手本を聴く' }).click()
  await page.clock.runFor(1250)
  await select(page, 'short-melody')
  await assertIdle(page, 5)
  const stopped = await page.evaluate(() => window.midiTest.outputMessages)
  expect(stopped.slice(-2).map((event) => event.data)).toEqual([[0x80, 67, 0], [0xb0, 123, 0]])
  expect(await page.evaluate(() => window.midiTest.outputClears.length)).toBeGreaterThan(0)
  await page.clock.runFor(20000)
  expect(await page.evaluate(() => window.midiTest.outputMessages.length)).toBe(stopped.length)
  await assertIdle(page, 5)
  await page.getByRole('button', { name: '手本を聴く' }).click()
  expect(await page.evaluate(() => window.midiTest.outputMessages.at(-2)!.data)).toEqual([0x90, 67, 80])
  await page.getByRole('button', { name: '停止', exact: true }).click()
  await page.getByRole('button', { name: 'テスト音 C4' }).click()
  await select(page, 'do-re-mi')
  await assertIdle(page, 7)
  expect(await page.evaluate(() => window.midiTest.outputMessages.slice(-2).map((event) => event.data))).toEqual([[0x80, 60, 0], [0xb0, 123, 0]])
  await page.clock.runFor(20000)
  await assertIdle(page, 7)
})

test('late B acquisition cannot replace C; loading blocks grading and leaves stop available', async ({ page }) => {
  await setup(page)
  let release!: () => void
  let entered!: () => void
  const requested = new Promise<void>((resolve) => { entered = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/*do-re-mi*', async (route) => { entered(); await gate; await route.continue() })
  await page.getByRole('button', { name: '練習開始', exact: true }).click()
  await strike(page, 60)
  await select(page, 'do-re-mi')
  await requested
  await expect(page.getByText('楽譜を読み込み中…', { exact: true })).toBeVisible()
  for (const name of ['練習開始', 'もう一度', '手本を聴く']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'すべての音を停止' })).toBeEnabled()
  await strike(page, 60)
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', '0')
  await expect(page.locator('.score-renderer')).toHaveCount(0)
  await select(page, 'short-melody')
  await assertIdle(page, 5)
  const response = page.waitForResponse((res) => res.url().includes('do-re-mi'))
  release()
  await response
  await page.waitForTimeout(100)
  await assertIdle(page, 5)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('短いメロディ')
})

test('cancels old OSMD setup while its shared importer is pending', async ({ page }) => {
  let release!: () => void
  let entered!: () => void
  const requested = new Promise<void>((resolve) => { entered = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route(/opensheetmusicdisplay.*\.js/, async (route) => { entered(); await gate; await route.continue() })
  await page.goto('./')
  await requested
  await select(page, 'do-re-mi')
  await select(page, 'short-melody')
  release()
  await assertIdle(page, 5)
  await expect(page.locator('.score-renderer')).toHaveCount(1)
  await expect(page.locator('.score-renderer .vf-stavenote')).toHaveCount(5)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('短いメロディ')
})

test('an old OSMD.load finishing after the new score cannot render or dispose the new cursor', async ({ page }) => {
  let moduleUrl = ''
  page.on('response', (response) => {
    if (/opensheetmusicdisplay.*\.js/.test(response.url())) moduleUrl = response.url()
  })
  await setup(page)
  expect(moduleUrl).not.toBe('')
  await page.evaluate(async (url) => {
    const module = await import(url)
    const OSMD = (module.OpenSheetMusicDisplay ?? module.default.OpenSheetMusicDisplay) as typeof import('opensheetmusicdisplay').OpenSheetMusicDisplay
    const original = OSMD.prototype.load
    OSMD.prototype.load = async function (...args: Parameters<typeof original>) {
      OSMD.prototype.load = original
      const state = window as unknown as { releaseOldLoad: () => void; oldLoadDone: boolean }
      await new Promise<void>((resolve) => { state.releaseOldLoad = resolve })
      const result = await original.apply(this, args)
      state.oldLoadDone = true
      return result
    }
  }, moduleUrl)
  await select(page, 'do-re-mi')
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { releaseOldLoad?: () => void }).releaseOldLoad)).toBe('function')
  await select(page, 'short-melody')
  await assertIdle(page, 5)
  await page.evaluate(() => (window as unknown as { releaseOldLoad: () => void }).releaseOldLoad())
  await expect.poll(() => page.evaluate(() => (window as unknown as { oldLoadDone: boolean }).oldLoadDone)).toBe(true)
  await assertIdle(page, 5)
  await expect(page.locator('.score-renderer .vf-stavenote')).toHaveCount(5)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: '練習開始', exact: true }).click()
  await strike(page, 67)
  await expect(page.locator('.position')).toHaveText('2 / 5 音')
})

const original = readFileSync(new URL('../../src/scores/do-re-mi.musicxml', import.meta.url), 'utf8')
const failures: { name: string; xml?: string; message: string }[] = [
  { name: 'network', message: '取得できませんでした' },
  { name: 'invalid XML', xml: '<score-partwise><broken>', message: '形式が正しくありません' },
  { name: 'no target notes', xml: original.replace(/<note>.*?<\/note>/g, ''), message: '練習対象の音がありません' },
  { name: 'unsupported grace', xml: original.replace('<note>', '<note><grace/>'), message: '未対応' },
  { name: 'invalid MIDI pitch', xml: original.replaceAll('<octave>4</octave>', '<octave>10</octave>'), message: '解析できませんでした' },
]
for (const failure of failures) {
  test(failure.name + ': failed selection never retains the old score/model and another song recovers', async ({ page }) => {
    await setup(page)
    await page.route('**/*do-re-mi*', (route: Route) => failure.xml === undefined
      ? route.abort('failed')
      : route.fulfill({ contentType: 'application/vnd.recordare.musicxml+xml', body: failure.xml }))
    await page.getByRole('button', { name: '練習開始', exact: true }).click()
    await strike(page, 60)
    await select(page, 'do-re-mi')
    await expect(page.getByRole('alert')).toContainText(failure.message)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ドレミの練習')
    await expect(page.locator('.score-renderer')).toHaveCount(0)
    await expect(page.locator('.position')).toHaveText('— / — 音')
    await strike(page, 60)
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', '0')
    for (const name of ['練習開始', 'もう一度', '手本を聴く']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled()
    await select(page, 'short-melody')
    await assertIdle(page, 5)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '手本を聴く' })).toBeEnabled()
  })
}

test('OSMD SVG rendering failure clears the failed score and permits recovery', async ({ page }) => {
  await setup(page)
  // Throw once at the actual SVG renderer boundary, without an application test hook.
  await page.evaluate(() => {
    const original = document.createElementNS.bind(document)
    document.createElementNS = ((...args: Parameters<typeof original>) => {
      if (args[0] === 'http://www.w3.org/2000/svg') {
        document.createElementNS = original
        throw new Error('Simulated SVG rendering failure')
      }
      return original(...args)
    }) as typeof document.createElementNS
  })
  await select(page, 'do-re-mi')
  await expect(page.getByRole('alert')).toContainText('表示できませんでした')
  await expect(page.locator('.score-renderer')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '手本を聴く' })).toBeDisabled()
  await select(page, 'short-melody')
  await assertIdle(page, 5)
})
