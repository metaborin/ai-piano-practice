import { expect, test } from '@playwright/test'
import { mockMidi } from './midiFixture'

test('library groups the three built-in songs, shows an empty personal area, and defaults to twinkle', async ({ page }) => {
  await page.goto('./')
  const library = page.getByRole('region', { name: '曲ライブラリ', exact: true })
  await expect(library).toBeVisible()
  await expect(library.getByRole('combobox', { name: '練習する曲' })).toHaveValue('twinkle-opening')
  await expect(library.locator('optgroup[label="内蔵曲"] option')).toHaveText(['きらきら星', 'ドレミの練習', '短いメロディ'])
  await expect(library).toContainText('内蔵曲：3曲')
  await expect(library.getByRole('region', { name: '自分の曲', exact: true })).toContainText('まだ追加された曲はありません')
  await expect(library.getByRole('button', { name: '＋ 曲を追加', exact: true })).toBeEnabled()
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await expect(page.locator('.score-renderer .vf-stavenote')).toHaveCount(14)
  await page.screenshot({ path: 'test-results/phase2ea-desktop.png', fullPage: true })
})

test('opening and cancelling the file picker preserves the current practice and MIDI connection', async ({ page }) => {
  const dialogs: string[] = []
  let fileChoosers = 0
  page.on('dialog', async (dialog) => { dialogs.push(dialog.type()); await dialog.dismiss() })
  page.on('filechooser', () => { fileChoosers++ })
  await mockMidi(page)
  await page.goto('./')
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await page.getByRole('button', { name: 'MIDI接続', exact: true }).click()
  await page.getByRole('button', { name: '練習開始', exact: true }).click()
  await page.evaluate(() => { window.midiTest.send([0x90, 60, 80]); window.midiTest.send([0x80, 60, 0]) })
  const add = page.getByRole('button', { name: '＋ 曲を追加', exact: true })
  await add.click()
  await add.click()
  await expect(page.locator('.position')).toHaveText('2 / 14 音')
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', '1')
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status', 'practicing')
  await expect(page.locator('.midi-status')).toHaveText('MIDI 接続中')
  expect(await page.evaluate(() => window.midiTest.requests)).toBe(1)
  await expect(page.locator('input[type="file"]')).toHaveAttribute('accept', '.musicxml,.xml,.mxl')
  expect(dialogs).toEqual([])
  expect(fileChoosers).toBe(2)
  await page.getByRole('combobox', { name: '練習する曲' }).selectOption('short-melody')
  await expect(page.locator('.position')).toHaveText('1 / 5 音')
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', '0')
  await expect(page.getByRole('form', { name: '曲の登録確認' })).toHaveCount(0)
})

test('library is usable by keyboard and touch at Chromebook and narrow screen widths', async ({ page }) => {
  await page.goto('./')
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  const select = page.getByRole('combobox', { name: '練習する曲' })
  await select.focus()
  await select.press('ArrowDown')
  await select.press('Enter')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ドレミの練習')
  await expect(page.locator('.position')).toHaveText('1 / 7 音')
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 768 })
    const selectBox = await select.boundingBox()
    const addBox = await page.getByRole('button', { name: '＋ 曲を追加' }).boundingBox()
    expect(selectBox!.height).toBeGreaterThanOrEqual(48)
    expect(addBox!.height).toBeGreaterThanOrEqual(48)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.screenshot({ path: 'test-results/phase2ea-mobile.png', fullPage: true })
})
