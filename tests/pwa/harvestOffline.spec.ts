import { expect, test } from '@playwright/test'
import { ready } from './helpers'
import { mockMidi } from '../e2e/midiFixture'

test.use({ serviceWorkers: 'allow' })
test.setTimeout(process.env.PLAYWRIGHT_BASE_URL ? 180_000 : 90_000)
test('the new solo score, MXL and original PDF work after an offline cold load', async ({ page, context }) => {
  await mockMidi(page); await page.goto('./'); await ready(page)
  await context.setOffline(true); await page.reload()
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await page.getByRole('combobox', { name: '練習する曲' }).selectOption('harvest-time')
  await expect(page.locator('.position')).toHaveText('1 / 331 ステップ')
  await expect(page.locator('.score-renderer svg')).toBeVisible()
  await page.getByRole('button', { name: '左手', exact: true }).click()
  await expect(page.locator('.position')).toHaveText('1 / 268 ステップ')
  await page.getByRole('button', { name: '元の楽譜', exact: true }).click()
  await expect(page.locator('.original-pdf')).toHaveAttribute('data-pages', '1')
  await expect(page.locator('.original-pdf canvas')).toHaveAttribute('data-rendered', 'true')
  expect(await page.evaluate(async () => {
    const r = await fetch(new URL('scores/harvest-time.mxl', document.baseURI))
    return r.ok && (await r.arrayBuffer()).byteLength > 1000
  })).toBe(true)
})
