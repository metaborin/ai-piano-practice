import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockMidi } from './midiFixture'
import { fixture, parseFixture } from '../unit/xmlFixture'
import { createPracticePlan } from '../../src/practice/PracticePlan'
import { buildDemoPlan } from '../../src/audio/buildDemoPlan'
import { referenceImage, referencePdf } from './originalFixtures'
import type { Song } from '../../src/songs/Song'

// These scenarios import/render a full score and PDF, and play a full first pass.
test.setTimeout(60_000)

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const card = (page: Page) => page.locator('.personal-song-list > li').first()
const confirmation = (page: Page) => page.getByRole('form', { name: '元の楽譜の登録・削除確認' })
const plan = createPracticePlan(parseFixture('maim-maim-full-original'), 'both')!
async function setup(page: Page) {
  await page.setViewportSize({ width: 1366, height: 900 }); await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockMidi(page); await page.goto('./'); await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await page.locator('.song-import input').setInputFiles({ name: 'mayim.musicxml', mimeType: 'application/xml', buffer: Buffer.from(fixture('maim-maim-full-original')) })
  await page.getByRole('form', { name: '曲の登録確認' }).getByRole('button', { name: '追加する', exact: true }).click()
  await card(page).getByRole('button', { name: '選択', exact: true }).click()
  await expect(page.locator('.current-measure')).toHaveText('1小節目')
  await button(page, 'MIDI接続').click()
}
async function choose(page: Page, name = 'reference.pdf', mimeType = 'application/pdf', buffer = referencePdf()) {
  await card(page).locator('.original-score-editor input').setInputFiles({ name, mimeType, buffer })
  await expect(confirmation(page)).toBeVisible()
}
async function attach(page: Page, name = 'reference.pdf', mimeType = 'application/pdf', buffer = referencePdf()) {
  await choose(page, name, mimeType, buffer)
  await confirmation(page).getByRole('button', { name: /^(登録する|置き換える)$/ }).click()
  await expect(confirmation(page)).toHaveCount(0)
}
async function records(page: Page) {
  return page.evaluate(() => new Promise<{ songs: Song[]; assets: { id: string; type: string; size: number; bytes: number[] }[]; version: number }>((resolve, reject) => {
    const open = indexedDB.open('ai-piano-practice')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction(['songs', 'originalScores'])
      const songs = tx.objectStore('songs').getAll(), assets = tx.objectStore('originalScores').getAll()
      tx.oncomplete = async () => {
        db.close()
        resolve({ songs: songs.result, version: db.version, assets: await Promise.all(assets.result.map(async ({ id, blob }: { id: string; blob: Blob }) => ({ id, type: blob.type, size: blob.size, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) }))) })
      }
      tx.onabort = () => reject(tx.error)
    }
  }))
}
async function strike(page: Page, pitches: readonly (readonly number[])[]) {
  await page.evaluate(groups => { for (const notes of groups) {
    for (const note of notes) window.midiTest.send([0x90, note, 80])
    for (const note of notes) window.midiTest.send([0x80, note, 0])
  } }, pitches)
}
async function midiState(page: Page) {
  return page.evaluate(() => ({ messages: window.midiTest.outputMessages.length, clears: window.midiTest.outputClears.length, requests: window.midiTest.requests, listeners: window.midiTest.inputListenerCount() }))
}

test('PDF confirmation, atomic association, reload, real multipage rendering and independent scroll restoration', async ({ page }) => {
  await setup(page)
  await expect(button(page, '元の楽譜')).toHaveCount(0)
  const before = (await records(page)).songs[0]
  await choose(page); expect((await records(page)).assets).toEqual([])
  await expect(confirmation(page)).toContainText('reference.pdf'); await expect(confirmation(page)).toContainText('application/pdf')
  await confirmation(page).getByRole('button', { name: 'キャンセル' }).click()
  expect((await records(page)).assets).toEqual([])
  await attach(page)
  const stored = await records(page), meta = stored.songs[0].originalScore!
  expect(stored.version).toBe(2)
  expect(stored.songs[0].musicXml).toEqual(before.musicXml)
  expect(meta).toMatchObject({ type: 'pdf', fileName: 'reference.pdf', mimeType: 'application/pdf', size: referencePdf().length })
  expect(meta.createdAt).toBeGreaterThan(0); expect(stored.assets[0].id).toBe(meta.storageId)
  expect(Buffer.from(stored.assets[0].bytes)).toEqual(referencePdf())
  await page.reload(); await card(page).getByRole('button', { name: '選択', exact: true }).click()
  await expect(page.locator('.score-overview')).toHaveAttribute('data-state', 'ready')
  await page.locator('.score-view').evaluate(el => { el.scrollTop = 500 })
  await expect.poll(() => page.locator('.score-view').evaluate(el => el.scrollTop)).toBe(500)
  const previous = await midiState(page)
  await button(page, '元の楽譜').click()
  await expect(page.locator('.score-overview')).toBeHidden()
  await expect(page.locator('.original-pdf')).toHaveAttribute('data-pages', '2')
  await expect(page.locator('.original-pdf canvas').first()).toHaveAttribute('data-rendered', 'true')
  await page.locator('.original-score-view').evaluate(el => { el.scrollTop = 1200 })
  await expect(page.locator('.original-pdf canvas').nth(1)).toHaveAttribute('data-rendered', 'true')
  expect(await page.locator('.original-pdf canvas').nth(1).evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    let ink = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 200 && pixels[i + 1] < 200 && pixels[i + 2] < 200) ink++
    return ink
  })).toBeGreaterThan(100)
  await expect.poll(() => page.locator('.original-score-view').evaluate(el => el.scrollTop)).toBe(1200)
  await page.screenshot({ path: 'test-results/phase2ee-pdf.png' })
  await button(page, '練習用楽譜').click()
  await expect(page.locator('.score-overview')).toBeVisible()
  expect(await page.locator('.score-view').evaluate(el => el.scrollTop)).toBe(500)
  await button(page, '元の楽譜').click()
  await expect(page.locator('.original-pdf canvas').nth(1)).toHaveAttribute('data-rendered', 'true')
  await expect.poll(() => page.locator('.original-score-view').evaluate(el => el.scrollTop)).toBe(1200)
  expect(await midiState(page)).toEqual(previous)
  expect(await records(page)).toEqual(stored)
})

for (const [extension, mime] of [['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp']]) test(extension + ': unmodified Blob, image fit, scrolling, return and Blob URL cleanup', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => {
    const create = URL.createObjectURL, revoke = URL.revokeObjectURL
    Object.assign(window, { imageUrls: [] as string[], revokedUrls: [] as string[] })
    URL.createObjectURL = function (blob) { const url = create.call(this, blob); if (blob instanceof Blob && blob.type.startsWith('image/') && blob.type !== 'image/svg+xml') (window as unknown as { imageUrls: string[] }).imageUrls.push(url); return url }
    URL.revokeObjectURL = function (url) { (window as unknown as { revokedUrls: string[] }).revokedUrls.push(url); revoke.call(this, url) }
  })
  const image = await referenceImage(page, mime)
  await attach(page, 'teacher.' + extension, mime, image)
  expect(Buffer.from((await records(page)).assets[0].bytes)).toEqual(image)
  await button(page, '元の楽譜').click()
  const picture = page.locator('.original-score-image')
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalHeight)).toBe(2400)
  await page.locator('.original-score-view').evaluate(el => { el.scrollTop = 700 })
  await expect.poll(() => page.locator('.original-score-view').evaluate(el => el.scrollTop)).toBe(700)
  await button(page, '練習用楽譜').click(); await button(page, '元の楽譜').click()
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(800)
  await expect.poll(() => page.locator('.original-score-view').evaluate(el => el.scrollTop)).toBe(700)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('combobox', { name: '練習する曲' }).selectOption('twinkle-opening')
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await expect(page.locator('.original-score-view')).toHaveCount(0)
  expect(await page.evaluate(() => {
    const state = window as unknown as { imageUrls: string[]; revokedUrls: string[] }
    return state.imageUrls.length >= 2 && state.imageUrls.every(url => state.revokedUrls.includes(url))
  })).toBe(true)
})

test('repeat pass, chord feedback, current occurrence, start mode and OSMD survive switching while practice continues', async ({ page }) => {
  await setup(page); await attach(page)
  await button(page, '両手').click(); await button(page, '練習開始').click()
  const second = plan.sequence.occurrences.findIndex(o => o.repeatPass === 2)
  await strike(page, plan.sequence.occurrences.slice(0, second).map(o => o.sourceTarget.expectedMidiNotes))
  await strike(page, [[127]])
  await expect(page.locator('.repeat-position')).toHaveText('反復 2回目')
  const red = await page.locator('[data-missing-note]').count(); expect(red).toBeGreaterThan(0)
  const prior = await midiState(page), position = await page.locator('.position').innerText()
  const cursor = await page.locator('.score-renderer img').getAttribute('style')
  await button(page, '元の楽譜').click(); await expect(page.locator('.original-pdf')).toBeVisible()
  await expect(page.locator('.practice-feedback')).toHaveText('もう一度♪')
  await expect(page.locator('.position')).toHaveText(position)
  await button(page, '練習用楽譜').click()
  await expect(page.locator('[data-missing-note]')).toHaveCount(red)
  expect(await page.locator('.score-renderer img').getAttribute('style')).toBe(cursor)
  await button(page, '元の楽譜').click()
  await strike(page, [plan.sequence.occurrences[second].sourceTarget.expectedMidiNotes])
  await expect(page.locator('.position')).toHaveText(`${second + 2} / ${plan.sequence.occurrences.length} ステップ`)
  await button(page, '練習用楽譜').click()
  await expect(page.locator('[data-missing-note]')).toHaveCount(0)
  await expect(button(page, '両手')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', String(second + 1))
  expect(await midiState(page)).toEqual(prior)
  await expect(page.locator('.score-overview')).toHaveAttribute('data-render-count', '1')
  await expect(page.locator('.overview-current')).toHaveAttribute('data-moment', plan.sequence.occurrences[second + 1].sourceMoment.id)
})

test('demo switches through original view during pass two with continuous scheduling and current OSMD recovery', async ({ page }) => {
  await setup(page); await button(page, '両手').click()
  await attach(page, 'notes.png', 'image/png', await referenceImage(page, 'image/png'))
  await button(page, '元の楽譜').click(); await expect.poll(() => page.locator('.original-score-image').evaluate((img: HTMLImageElement) => img.complete)).toBe(true)
  await button(page, '練習用楽譜').click()
  await page.clock.install(); await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 100)))
  await button(page, '手本を聴く').click()
  const notes = buildDemoPlan(plan), second = plan.sequence.occurrences.findIndex(o => o.repeatPass === 2)
  const jump = notes.find(n => n.index === second)!
  await page.clock.runFor(Math.ceil(jump.startMs) + 1)
  await expect(page.locator('.repeat-position')).toHaveText('反復 2回目')
  const prior = await midiState(page)
  await button(page, '元の楽譜').click()
  expect(await midiState(page)).toEqual(prior)
  const oldCursor = await page.locator('.score-renderer img').getAttribute('style')
  await page.clock.runFor(1100)
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'playing')
  expect(await page.locator('.score-renderer img').getAttribute('style')).toBe(oldCursor)
  const after = await midiState(page); expect(after.messages).toBeGreaterThan(prior.messages); expect(after.clears).toBe(prior.clears)
  await button(page, '練習用楽譜').click(); await page.clock.runFor(20)
  await expect(page.locator('.repeat-position')).toHaveText('反復 2回目')
  const index = Number((await page.locator('.position').innerText()).split(' / ')[0]) - 1
  await expect(page.locator('.overview-current')).toHaveAttribute('data-moment', plan.sequence.occurrences[index].sourceMoment.id)
  const state = await midiState(page); expect(state.clears).toBe(prior.clears); expect(state.requests).toBe(1); expect(state.listeners).toBe(1)
  const duplicateOns = await page.evaluate(() => { const notes = window.midiTest.outputMessages.filter(m => m.data[0] === 0x90); return notes.length - new Set(notes.map(n => `${n.data[1]}:${n.timestamp}`)).size })
  expect(duplicateOns).toBe(0)
})

test('replacement, original-only deletion and Song deletion atomically clean old Blobs without changing practice', async ({ page }) => {
  await setup(page); await attach(page); await button(page, '練習開始').click()
  const original = await records(page), id = original.assets[0].id
  await choose(page, 'new.png', 'image/png', await referenceImage(page, 'image/png'))
  await expect(confirmation(page)).toContainText('置き換えますか')
  await confirmation(page).getByRole('button', { name: 'キャンセル' }).click(); expect(await records(page)).toEqual(original)
  await attach(page, 'new.png', 'image/png', await referenceImage(page, 'image/png'))
  const replaced = await records(page); expect(replaced.assets).toHaveLength(1); expect(replaced.assets[0].id).not.toBe(id)
  await button(page, '元の楽譜').click(); await expect(page.locator('.original-score-image')).toBeVisible()
  await button(page, '元の楽譜を削除').click(); await button(page, '元の楽譜だけ削除する').click()
  const deleted = await records(page); expect(deleted.assets).toEqual([]); expect(deleted.songs[0].originalScore).toBeUndefined()
  expect(deleted.songs[0].musicXml).toEqual(original.songs[0].musicXml)
  await expect(page.locator('.score-view')).toBeVisible(); await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status', 'practicing')
  await attach(page); await card(page).getByRole('button', { name: '削除', exact: true }).click(); await button(page, '削除する').click()
  expect((await records(page)).songs).toEqual([]); expect((await records(page)).assets).toEqual([])
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
})
