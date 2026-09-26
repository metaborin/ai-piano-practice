import { expect, test } from '@playwright/test'

test('the Pages build loads its bundled MusicXML, styles and OSMD from the repository subpath', async ({ page, baseURL }) => {
  const failures: string[] = []
  const scripts: string[] = []
  const styles: string[] = []
  const musicXml: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))
  page.on('requestfailed', (request) => failures.push(request.url()))
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`)
    if (response.request().resourceType() === 'script') scripts.push(response.url())
    if (response.request().resourceType() === 'stylesheet') styles.push(response.url())
    if (new URL(response.url()).pathname.endsWith('.musicxml')) musicXml.push(response.url())
  })
  const response = await page.goto('./')
  expect(response?.status()).toBe(200)
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await expect(page.locator('.score-renderer .vf-stavenote')).toHaveCount(14)
  await expect(page.locator('.score-renderer img')).toBeVisible()
  for (const [id, count] of [['do-re-mi', 7], ['short-melody', 5]] as const) {
    await page.getByRole('combobox', { name: '練習する曲' }).selectOption(id)
    await expect(page.locator('.position')).toHaveText(`1 / ${count} 音`)
    await expect(page.locator('.score-renderer .vf-stavenote')).toHaveCount(count)
  }
  expect(scripts.length).toBeGreaterThanOrEqual(2)
  expect(styles.length).toBeGreaterThanOrEqual(1)
  const assetsPrefix = new URL('assets/', baseURL).href
  expect(new Set(musicXml).size).toBe(3)
  for (const url of [...scripts, ...styles, ...musicXml]) expect(url.startsWith(assetsPrefix)).toBe(true)
  // Vite emits the existing XML files at base-aware URLs used by the repository.
  expect(failures).toEqual([])
  await page.reload()
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await expect(page.locator('.score-renderer .vf-stavenote')).toHaveCount(14)
  expect(failures).toEqual([])
})
