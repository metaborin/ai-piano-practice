import { afterEach, describe, expect, it, vi } from 'vitest'
import { PwaClient } from '../../src/pwa/PwaClient'
import type { InstallPrompt, PwaHost } from '../../src/pwa/PwaClient'
import { APP_BASE, pwaOptions } from '../../pwa.config'
import { readFileSync } from 'node:fs'

const clients: PwaClient[] = []
afterEach(() => { clients.splice(0).forEach(client => client.dispose()); vi.useRealTimers() })
function setup(active = false, standalone = false) {
  const worker = () => Object.assign(new EventTarget(), { state: 'installing', postMessage: vi.fn() })
  const old = worker(), next = worker()
  const registration = Object.assign(new EventTarget(), { active: active ? old : null, waiting: null as ReturnType<typeof worker> | null, installing: null as ReturnType<typeof worker> | null, update: vi.fn().mockResolvedValue(undefined) })
  const serviceWorker = Object.assign(new EventTarget(), { controller: active ? old : null, register: vi.fn().mockResolvedValue(registration) })
  const host = { events: new EventTarget(), visibility: new EventTarget(), displayMode: Object.assign(new EventTarget(), { matches: standalone }), online: () => true, visible: () => true, serviceWorker: serviceWorker as unknown as ServiceWorkerContainer, reload: vi.fn() } satisfies PwaHost
  const client = new PwaClient(host, APP_BASE); clients.push(client)
  const waiting = () => {
    registration.installing = next; registration.dispatchEvent(new Event('updatefound'))
    registration.waiting = next; registration.installing = null; next.state = 'installed'; next.dispatchEvent(new Event('statechange'))
  }
  const activate = () => { registration.active = next; registration.waiting = null; next.state = 'activated'; next.dispatchEvent(new Event('statechange')); serviceWorker.controller = next; serviceWorker.dispatchEvent(new Event('controllerchange')) }
  return { client, host, serviceWorker, registration, next, waiting, activate }
}

describe('PWA lifecycle independent from practice and MIDI', () => {
  it('registers once at the Pages scope without the HTTP cache and claims first install without reload', async () => {
    const { client, serviceWorker, registration, activate, host } = setup()
    await client.start(); await client.start()
    expect(serviceWorker.register).toHaveBeenCalledExactlyOnceWith('/ai-piano-practice/sw.js', { scope: APP_BASE, updateViaCache: 'none' })
    registration.installing = null; activate()
    expect(client.getSnapshot()).toMatchObject({ offlineReady: true, needRefresh: false })
    expect(host.reload).not.toHaveBeenCalled()
  })
  it('detects an update but does not activate, reset anything, or reload until accepted', async () => {
    const { client, waiting, next, activate, host } = setup(true)
    await client.start(); waiting()
    expect(client.getSnapshot().needRefresh).toBe(true)
    expect(next.postMessage).not.toHaveBeenCalled(); expect(host.reload).not.toHaveBeenCalled()
    const stop = vi.fn(); client.applyUpdate(stop)
    expect(next.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'SKIP_WAITING' })
    expect(stop).not.toHaveBeenCalled()
    activate(); activate()
    expect(stop).toHaveBeenCalledTimes(1); expect(host.reload).toHaveBeenCalledTimes(1)
  })
  it('finds a worker already waiting at startup', async () => {
    const { client, registration, next } = setup(true)
    registration.waiting = next; await client.start()
    expect(client.getSnapshot().needRefresh).toBe(true)
    expect(next.postMessage).not.toHaveBeenCalled()
  })
  it('another window activating never reloads this window; later local consent does', async () => {
    const { client, activate, host } = setup(true)
    await client.start(); activate()
    expect(client.getSnapshot().needRefresh).toBe(true); expect(host.reload).not.toHaveBeenCalled()
    client.applyUpdate(vi.fn()); expect(host.reload).toHaveBeenCalledTimes(1)
  })
  it('update timeout leaves practice running and permits retry', async () => {
    vi.useFakeTimers()
    const { client, waiting, activate, host } = setup(true)
    await client.start(); waiting(); const stop = vi.fn(); client.applyUpdate(stop)
    vi.advanceTimersByTime(15_000)
    expect(client.getSnapshot()).toMatchObject({ updating: false, needRefresh: true })
    expect(stop).not.toHaveBeenCalled(); expect(host.reload).not.toHaveBeenCalled()
    client.applyUpdate(stop); activate(); expect(stop).toHaveBeenCalledTimes(1)
  })
  it('registration failure is contained; unsupported and development environments need no worker', async () => {
    const { client, serviceWorker, host } = setup()
    serviceWorker.register.mockRejectedValue(new Error('blocked')); await client.start()
    expect(client.getSnapshot().message).toContain('保存を開始できません')
    const unsupported = new PwaClient({ ...host, serviceWorker: undefined }, APP_BASE)
    const dev = new PwaClient(host, APP_BASE, false); clients.push(unsupported, dev)
    await unsupported.start(); await dev.start()
    expect(serviceWorker.register).toHaveBeenCalledTimes(1)
  })
  it('reports incomplete first precache without claiming offline readiness', async () => {
    const { client, registration, next } = setup(); await client.start()
    registration.installing = next; registration.dispatchEvent(new Event('updatefound'))
    next.state = 'redundant'; next.dispatchEvent(new Event('statechange'))
    expect(client.getSnapshot()).toMatchObject({ offlineReady: false, needRefresh: false })
    expect(client.getSnapshot().message).toContain('保存に失敗')
  })
  it('offline / online and visibility update only PWA state, with throttled and manual update checks', async () => {
    vi.useFakeTimers()
    const { client, host, registration } = setup(true); await client.start(); await Promise.resolve()
    host.events.dispatchEvent(new Event('offline')); expect(client.getSnapshot().online).toBe(false)
    await client.checkForUpdate(true); expect(registration.update).toHaveBeenCalledTimes(1)
    host.events.dispatchEvent(new Event('online')); expect(client.getSnapshot().online).toBe(true)
    host.events.dispatchEvent(new Event('focus')); expect(registration.update).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_001); host.visibility.dispatchEvent(new Event('visibilitychange')); await Promise.resolve()
    expect(registration.update).toHaveBeenCalledTimes(2)
    await client.checkForUpdate(true); expect(registration.update).toHaveBeenCalledTimes(3)
    expect(host.reload).not.toHaveBeenCalled()
  })
  it('hourly check catches long-running installs; transient update failures are retryable', async () => {
    vi.useFakeTimers()
    const { client, registration, host } = setup(true); await client.start(); await Promise.resolve()
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(registration.update).toHaveBeenCalledTimes(2)
    registration.update.mockRejectedValueOnce(new Error('offline'))
    await client.checkForUpdate(true); expect(client.getSnapshot().message).toContain('確認できません')
    await client.checkForUpdate(true); expect(client.getSnapshot().message).toContain('確認しました')
    client.dispose(); const calls = registration.update.mock.calls.length
    host.events.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(registration.update).toHaveBeenCalledTimes(calls)
  })
  for (const outcome of ['accepted', 'dismissed'] as const) it(`install prompt: ${outcome}, no automatic prompt and no error`, async () => {
    const { client, host } = setup(); await client.start()
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: vi.fn().mockResolvedValue(undefined), userChoice: Promise.resolve({ outcome }) }) satisfies InstallPrompt
    host.events.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true); expect(client.getSnapshot().installAvailable).toBe(true)
    expect(event.prompt).not.toHaveBeenCalled(); await client.install(); await client.install()
    expect(event.prompt).toHaveBeenCalledTimes(1); expect(client.getSnapshot().installAvailable).toBe(false)
    expect(client.getSnapshot().message).toBe('')
  })
  it('standalone, appinstalled and fullscreen display-mode changes hide install controls', async () => {
    const { client, host } = setup(false, true); await client.start()
    const event = Object.assign(new Event('beforeinstallprompt'), { prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'accepted' as const }) })
    host.events.dispatchEvent(event); await client.install(); expect(event.prompt).not.toHaveBeenCalled()
    expect(client.getSnapshot()).toMatchObject({ standalone: true, installAvailable: false })
    host.displayMode.matches = false; host.displayMode.dispatchEvent(new Event('change'))
    expect(client.getSnapshot().standalone).toBe(true)
    const browser = setup(); await browser.client.start(); browser.host.events.dispatchEvent(new Event('appinstalled'))
    browser.host.events.dispatchEvent(event); expect(browser.client.getSnapshot().installAvailable).toBe(false)
  })
})

describe('manifest and static assets', () => {
  it('uses repository-relative launch, scope, identity and standalone Japanese metadata', () => {
    expect(pwaOptions.manifest).toMatchObject({ id: APP_BASE, start_url: APP_BASE, scope: APP_BASE, name: 'AIピアノ練習アプリ', short_name: 'AIピアノ', description: 'MIDI対応のピアノ練習アプリ', display: 'standalone', orientation: 'any', lang: 'ja' })
    expect(pwaOptions).toMatchObject({ injectRegister: false, registerType: 'prompt', workbox: { skipWaiting: false, cleanupOutdatedCaches: true, runtimeCaching: [] } })
  })
  it('ships real PNGs at their declared sizes including an opaque maskable icon', () => {
    const manifest = pwaOptions.manifest; if (!manifest) throw new Error('Missing manifest')
    expect(manifest.icons?.some(icon => icon.purpose === 'maskable')).toBe(true)
    expect(manifest.icons?.map(icon => icon.sizes)).toContain('192x192')
    for (const icon of manifest.icons!) {
      const data = readFileSync(new URL(`../../public/${icon.src}`, import.meta.url))
      expect(data.subarray(1, 4).toString()).toBe('PNG')
      expect(`${data.readUInt32BE(16)}x${data.readUInt32BE(20)}`).toBe(icon.sizes)
    }
  })
})
