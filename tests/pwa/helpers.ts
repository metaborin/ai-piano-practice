import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { fixture } from '../unit/xmlFixture'
import { referenceImage, referencePdf } from '../e2e/originalFixtures'

export const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
export const savedCard = (page: Page) => page.locator('.personal-song-list > li').first()
export async function ready(page: Page) {
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  // A cold Pages edge may take over 30s to deliver the complete PDF/font precache.
  const cacheTimeout = process.env.PLAYWRIGHT_BASE_URL ? 120_000 : 30_000
  await expect(page.locator('.pwa-controls')).toHaveAttribute('data-offline-ready', 'true', { timeout: cacheTimeout })
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
}
export async function saveSong(page: Page, kind: 'pdf' | 'image' = 'pdf') {
  await page.locator('.song-import input').setInputFiles({ name: 'mayim.musicxml', mimeType: 'application/xml', buffer: Buffer.from(fixture('maim-maim-full-original')) })
  await page.getByRole('form', { name: '曲の登録確認' }).getByRole('button', { name: '追加する', exact: true }).click()
  await savedCard(page).locator('.original-score-editor input').setInputFiles(kind === 'pdf'
    ? { name: 'reference.pdf', mimeType: 'application/pdf', buffer: referencePdf() }
    : { name: 'reference.png', mimeType: 'image/png', buffer: await referenceImage(page, 'image/png') })
  await page.getByRole('form', { name: '元の楽譜の登録・削除確認' }).getByRole('button', { name: '登録する', exact: true }).click()
  await expect(page.getByRole('form', { name: '元の楽譜の登録・削除確認' })).toHaveCount(0)
}
export async function records(page: Page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('ai-piano-practice')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction(['songs', 'originalScores'])
      const songs = tx.objectStore('songs').getAll(), assets = tx.objectStore('originalScores').getAll()
      tx.oncomplete = async () => {
        db.close()
        resolve({ version: db.version, songs: songs.result, assets: await Promise.all(assets.result.map(async ({ id, blob }: { id: string; blob: Blob }) => ({ id, type: blob.type, size: blob.size, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) }))) })
      }
      tx.onabort = () => reject(tx.error)
    }
  }))
}
export async function midiState(page: Page) {
  return page.evaluate(() => ({ requests: window.midiTest.requests, listeners: window.midiTest.inputListenerCount(), clears: window.midiTest.outputClears.length, messages: window.midiTest.outputMessages.length }))
}
export async function simulateInstallPrompt(page: Page) {
  await page.evaluate(() => {
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: async () => { sessionStorage.setItem('test-install-prompt', 'shown') },
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    })
    window.dispatchEvent(event)
  })
}
export async function simulateStandalone(page: Page) {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window)
    window.matchMedia = query => {
      const media = original(query)
      if (query === '(display-mode: standalone)') Object.defineProperty(media, 'matches', { value: true })
      return media
    }
  })
}
