import { expect, test } from '@playwright/test'
import { mockMidi } from '../e2e/midiFixture'
import { button, midiState, ready, records, saveSong } from './helpers'
import { versionServer } from './versionServer'

test.use({ serviceWorkers: 'allow' })
test.setTimeout(90_000)
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, 'Two releases are simulated only on the isolated local server.')

for (const activity of ['idle', 'practice', 'demo'] as const) test(`${activity}: real waiting worker, consent, one reload, precache cleanup and intact IndexedDB`, async ({ page, context }) => {
  const server = await versionServer()
  try {
    await mockMidi(page); await page.goto(server.url); await ready(page)
    await saveSong(page)
    const stored = await records(page)
    await page.evaluate(async () => { await (await caches.open('unrelated-project-cache')).put('/unrelated-record', new Response('keep')); sessionStorage.setItem('test-loads', '1') })
    await page.addInitScript(() => {
      sessionStorage.setItem('test-loads', String(Number(sessionStorage.getItem('test-loads')) + 1))
    })
    await button(page, 'MIDI接続').click()
    if (activity === 'practice') {
      await button(page, '練習開始').click()
      await page.evaluate(() => { window.midiTest.send([0x90, 60, 80]); window.midiTest.send([0x80, 60, 0]) })
    }
    if (activity === 'demo') {
      await page.clock.install(); await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 100)))
      await button(page, '手本を聴く').click(); await page.clock.runFor(200)
    }
    const before = await midiState(page), position = await page.locator('.position').innerText()
    const state = await page.locator('.practice-controls').getAttribute('data-practice-status')
    for (const event of ['offline', 'online']) await page.evaluate(type => window.dispatchEvent(new Event(type)), event)
    server.publish()
    await page.locator('.pwa-help summary').click(); await button(page, '更新を確認').click()
    await expect(page.locator('.pwa-update')).toContainText('新しいバージョンがあります', { timeout: 30_000 })
    expect(await page.evaluate(() => sessionStorage.getItem('test-loads'))).toBe('1')
    await expect(page.locator('.position')).toHaveText(position)
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status', state!)
    expect(await midiState(page)).toEqual(before)
    expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(true)
    const navigation = page.waitForEvent('framenavigated', frame => frame === page.mainFrame())
    await button(page, '更新する').click()
    if (activity !== 'idle') {
      await expect(page.getByRole('alertdialog', { name: 'アプリの更新確認' })).toBeVisible()
      await button(page, 'キャンセル').click()
      expect(await midiState(page)).toEqual(before)
      await expect(page.locator('.position')).toHaveText(position)
      await button(page, '更新する').click()
      // Persist only test observations across reload, to assert scheduled and sounding notes stop.
      await page.evaluate(() => {
        window.addEventListener('pagehide', () => {
          sessionStorage.setItem('test-last-output', JSON.stringify(window.midiTest.outputMessages))
          sessionStorage.setItem('test-last-clears', String(window.midiTest.outputClears.length))
        })
      })
      await button(page, '更新して再読み込み').click()
    }
    await navigation
    await page.waitForLoadState('domcontentloaded')
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('test-loads'))).toBe('2')
    await ready(page)
    expect(await records(page)).toEqual(stored)
    await expect(page.locator('.pwa-update')).toHaveCount(0)
    const cachesAfter = await page.evaluate(async () => ({
      keys: await caches.keys(),
      urls: (await Promise.all((await caches.keys()).filter(key => key.startsWith('ai-piano-practice')).map(async key => (await (await caches.open(key)).keys()).map(request => request.url)))).flat(),
    }))
    expect(cachesAfter.keys).toContain('unrelated-project-cache')
    expect(cachesAfter.urls.some(url => url.includes('old-release.txt'))).toBe(false)
    expect(cachesAfter.urls.some(url => url.includes('new-release.txt'))).toBe(true)
    if (activity === 'demo') {
      const output = JSON.parse(await page.evaluate(() => sessionStorage.getItem('test-last-output')) || '[]') as { data: number[] }[]
      expect(output.some(message => message.data[0] === 0x80)).toBe(true)
      expect(output.some(message => message.data[0] === 0xb0 && message.data[1] === 123)).toBe(true)
      expect(Number(await page.evaluate(() => sessionStorage.getItem('test-last-clears')))).toBeGreaterThan(before.clears)
    }
  } finally { await context.close(); await server.close() }
})

test('another window approving a worker never reloads an ongoing practice window', async ({ page, context }) => {
  const server = await versionServer()
  try {
    await mockMidi(page); await page.goto(server.url); await ready(page)
    await button(page, 'MIDI接続').click(); await button(page, '練習開始').click()
    await page.evaluate(() => { window.midiTest.send([0x90, 60, 80]); window.midiTest.send([0x80, 60, 0]) })
    const before = await midiState(page)
    const other = await context.newPage(); await other.goto(server.url); await ready(other)
    server.publish()
    await other.locator('.pwa-help summary').click(); await button(other, '更新を確認').click()
    await expect(other.locator('.pwa-update')).toBeVisible({ timeout: 30_000 })
    await button(other, '更新する').click(); await ready(other)
    await expect(page.locator('.pwa-update')).toBeVisible()
    await expect(page.locator('.position')).toHaveText('2 / 14 音')
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status', 'practicing')
    expect(await midiState(page)).toEqual(before)
  } finally { await context.close(); await server.close() }
})
