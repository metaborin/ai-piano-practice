import type { VitePWAOptions } from 'vite-plugin-pwa'

export const APP_BASE = '/ai-piano-practice/'

export const pwaOptions: Partial<VitePWAOptions> = {
  base: APP_BASE,
  scope: APP_BASE,
  registerType: 'prompt',
  // PwaClient registers once and reloads only the window that accepted the update.
  injectRegister: false,
  manifest: {
    id: APP_BASE,
    name: 'AIピアノ練習アプリ',
    short_name: 'AIピアノ',
    description: 'MIDI対応のピアノ練習アプリ',
    start_url: APP_BASE,
    scope: APP_BASE,
    display: 'standalone',
    orientation: 'any',
    lang: 'ja',
    theme_color: '#28694e',
    background_color: '#f5f7f5',
    icons: [
      { src: 'icons/piano-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icons/piano-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icons/piano-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: {
    cacheId: 'ai-piano-practice',
    cleanupOutdatedCaches: true,
    skipWaiting: false,
    clientsClaim: true,
    // Include lazy PDF.js, its worker, CMaps, fonts and decoders before going offline.
    globPatterns: ['**/*.{html,js,mjs,css,svg,png,webmanifest,musicxml}', 'pdfjs/**/*'],
    maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
    navigateFallback: `${APP_BASE}index.html`,
    navigateFallbackAllowlist: [/^\/ai-piano-practice\//],
    // User songs/PDFs/images remain solely in IndexedDB. No runtime or Blob cache.
    runtimeCaching: [],
  },
  devOptions: { enabled: false },
}
