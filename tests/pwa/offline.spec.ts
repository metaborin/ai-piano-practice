import { expect, test } from '@playwright/test'
import { mockMidi } from '../e2e/midiFixture'
import { button, midiState, ready, records, savedCard, saveSong, simulateInstallPrompt, simulateStandalone } from './helpers'

test.use({ serviceWorkers: 'allow' })
test.setTimeout(process.env.PLAYWRIGHT_BASE_URL ? 180_000 : 90_000)

test('manifest, Chrome installability, scoped worker and complete static precache', async ({ page, context, baseURL }) => {
  await page.goto('./'); await ready(page)
  const manifestUrl = await page.locator('link[rel=manifest]').getAttribute('href')
  expect(new URL(manifestUrl!, page.url()).pathname).toBe('/ai-piano-practice/manifest.webmanifest')
  const response = await page.request.get(new URL(manifestUrl!, page.url()).href)
  expect(response.ok()).toBe(true)
  const manifest = await response.json()
  expect(manifest).toMatchObject({ name: 'AIピアノ練習アプリ', short_name: 'AIピアノ', display: 'standalone', start_url: '/ai-piano-practice/', scope: '/ai-piano-practice/', lang: 'ja' })
  for (const icon of manifest.icons) {
    const iconResponse = await page.request.get(new URL(icon.src, new URL(manifestUrl!, page.url())).href)
    expect(iconResponse.ok()).toBe(true)
    const bytes = await iconResponse.body()
    expect(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`).toBe(icon.sizes)
  }
  const cdp = await context.newCDPSession(page)
  const result = await cdp.send('Page.getAppManifest')
  expect(result.errors).toEqual([])
  expect((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors).toEqual([])
  const cached = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    const keys = await caches.keys()
    const entries = (await Promise.all(keys.map(async key => (await (await caches.open(key)).keys()).map(request => request.url)))).flat()
    return { scope: reg.scope, state: reg.active?.state, entries }
  })
  expect(cached.scope).toBe(new URL('/ai-piano-practice/', baseURL).href)
  expect(cached.state).toBe('activated')
  expect(cached.entries.every(url => new URL(url).pathname.startsWith('/ai-piano-practice/'))).toBe(true)
  expect(cached.entries.filter(url => url.includes('.musicxml'))).toHaveLength(3)
  for (const piece of ['index.html', 'manifest.webmanifest', 'opensheetmusicdisplay', 'pdf.worker', '/pdfjs/cmaps/', '/pdfjs/standard_fonts/', '/pdfjs/wasm/']) expect(cached.entries.some(url => url.includes(piece))).toBe(true)
})

test('offline navigation fallback and all built-ins retain mock MIDI practice and demo', async ({ page, context }) => {
  await mockMidi(page); await page.goto('./'); await ready(page)
  await context.setOffline(true)
  await page.goto('./offline-check')
  await expect(page.getByText('オフラインです', { exact: true })).toBeVisible()
  for (const [id, count] of [['twinkle-opening', 14], ['do-re-mi', 7], ['short-melody', 5]] as const) {
    await page.getByRole('combobox', { name: '練習する曲' }).selectOption(id)
    await expect(page.locator('.position')).toHaveText(`1 / ${count} 音`)
    await expect(page.locator('.score-renderer .vf-stavenote')).toHaveCount(count)
  }
  await page.getByRole('combobox', { name: '練習する曲' }).selectOption('twinkle-opening')
  await button(page, 'MIDI接続').click(); await button(page, '練習開始').click()
  await page.evaluate(() => { window.midiTest.send([0x90, 60, 80]); window.midiTest.send([0x80, 60, 0]) })
  await expect(page.locator('.position')).toHaveText('2 / 14 音')
  await page.clock.install(); await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 100)))
  await button(page, '手本を聴く').click(); await page.clock.runFor(1100)
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status', 'playing')
  expect((await midiState(page)).messages).toBeGreaterThan(0)
  await button(page, '停止').click()
  await expect(page.locator('.position')).toHaveText('2 / 14 音')
  const before = await midiState(page)
  await context.setOffline(false)
  await expect(page.getByText('オフラインです', { exact: true })).toHaveCount(0)
  expect(await midiState(page)).toEqual(before)
})

for (const kind of ['pdf', 'image'] as const) test(`saved ${kind} and MusicXML survive offline cold opening in a second standalone-simulated window`, async ({ page, context, baseURL }) => {
  await page.goto('./'); await ready(page); await saveSong(page, kind)
  // Never open PDF.js online: its lazy bundle, worker and fonts must come from precache.
  const stored = await records(page)
  const installed = await context.newPage()
  await simulateStandalone(installed); await mockMidi(installed)
  await installed.setViewportSize({ width: 1366, height: 768 })
  await context.setOffline(true); await installed.goto(baseURL!)
  await expect(installed.locator('.pwa-controls')).toHaveAttribute('data-standalone', 'true')
  expect(await records(installed)).toEqual(stored)
  await savedCard(installed).getByRole('button', { name: '選択', exact: true }).click()
  await expect(installed.locator('.score-overview')).toHaveAttribute('data-state', 'ready')
  await button(installed, '元の楽譜').click()
  if (kind === 'pdf') {
    await expect(installed.locator('.original-pdf')).toHaveAttribute('data-pages', '2')
    await expect(installed.locator('.original-pdf canvas').first()).toHaveAttribute('data-rendered', 'true')
    await installed.locator('.original-score-view').evaluate(el => { el.scrollTop = 1200 })
    await expect(installed.locator('.original-pdf canvas').nth(1)).toHaveAttribute('data-rendered', 'true')
    expect(await installed.locator('.original-pdf canvas').nth(1).evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      let ink = 0
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 200 && pixels[i + 1] < 200 && pixels[i + 2] < 200 && pixels[i + 3] > 0) ink++
      return ink
    })).toBeGreaterThan(100)
    await installed.locator('.original-score-view').evaluate(el => { el.scrollTop = 0 })
  } else await expect.poll(() => installed.locator('.original-score-image').evaluate((el: HTMLImageElement) => el.naturalHeight)).toBe(2400)
  await button(installed, 'MIDI接続').click(); await button(installed, '練習開始').click()
  const midi = await midiState(installed)
  await button(installed, '原譜で全画面練習').click()
  await expect(installed.locator('.practice-workspace')).toHaveAttribute('data-fullscreen', 'true')
  expect(await installed.evaluate(() => !!document.fullscreenElement)).toBe(true)
  await expect(installed.locator('.practice-controls')).toHaveAttribute('data-practice-status', 'practicing')
  expect(await midiState(installed)).toEqual(midi)
  await installed.screenshot({ path: `test-results/phase2f-offline-${kind}.png` })
  await button(installed, '× 全画面終了').click(); await button(installed, '練習用楽譜').click()
  await expect(installed.locator('.score-overview')).toBeVisible()
  await installed.setViewportSize({ width: 390, height: 844 })
  expect(await installed.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await records(installed)).toEqual(stored)
  await installed.close()
})

test('install, connectivity and update-check UI preserve practice position and one MIDI handler', async ({ page }) => {
  await mockMidi(page); await page.goto('./'); await ready(page)
  await button(page, 'MIDI接続').click(); await button(page, '練習開始').click()
  await page.evaluate(() => { window.midiTest.send([0x90, 60, 80]); window.midiTest.send([0x80, 60, 0]) })
  const before = await midiState(page)
  await simulateInstallPrompt(page)
  await button(page, 'アプリをインストール').click()
  expect(await page.evaluate(() => sessionStorage.getItem('test-install-prompt'))).toBe('shown')
  await expect(button(page, 'アプリをインストール')).toHaveCount(0)
  for (const type of ['offline', 'online', 'appinstalled']) await page.evaluate(type => window.dispatchEvent(new Event(type)), type)
  await page.locator('.pwa-help summary').click(); await button(page, '更新を確認').click()
  await expect(page.locator('.pwa-message')).toContainText('更新を確認しました')
  await expect(page.locator('.position')).toHaveText('2 / 14 音')
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status', 'practicing')
  expect(await midiState(page)).toEqual(before)
})

test('standalone hides install button, including across original fullscreen media changes', async ({ page }) => {
  await simulateStandalone(page); await page.goto('./'); await ready(page)
  await simulateInstallPrompt(page)
  await expect(page.locator('.pwa-controls')).toHaveAttribute('data-standalone', 'true')
  await expect(button(page, 'アプリをインストール')).toHaveCount(0)
  await page.locator('.pwa-help summary').click()
  await expect(page.locator('.pwa-help')).toContainText('アプリのウィンドウで起動しています')
})
