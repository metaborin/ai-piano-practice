import { test, expect } from '@playwright/test'

for (const version of ['once','original']) for (const extension of ['musicxml','mxl']) {
  test(`new PRIMO ${version} ${extension} imports, renders and enables existing practice/demo`, async ({ page }) => {
    await page.goto('./')
    await expect(page.locator('.position')).toHaveText('1 / 14 音')
    const path = extension === 'musicxml' ? `src/scores/duet/maim-maim-primo-${version}.musicxml` : `public/duet-scores/maim-maim-primo-${version}.mxl`
    await page.locator('.song-import input').setInputFiles(path)
    const dialog = page.getByRole('form', { name: '曲の登録確認' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '追加する', exact: true }).click()
    const item = page.locator('.personal-song-list > li').last()
    await item.getByRole('button', { name: '選択', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('PRIMO')
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status', 'idle')
    await expect(page.locator('.position')).toHaveText(version === 'once' ? '1 / 118 ステップ' : '1 / 218 ステップ')
    await expect(page.locator('.score-renderer svg').first()).toBeVisible()
    await expect(page.locator('.score-overview')).toHaveAttribute('data-state', 'ready')
  })
}
