// Original vector artwork; reproducible PNGs without third-party image assets.
import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
const folder = new URL('../public/icons/', import.meta.url)
const svg = await readFile(new URL('piano.svg', folder), 'utf8')
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  for (const [name, size] of [['piano-192', 192], ['piano-512', 512], ['piano-maskable-512', 512], ['apple-touch-icon', 180]]) {
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(`<style>html,body{margin:0}svg{width:100vw;height:100vh;display:block}</style>${svg}`)
    await writeFile(new URL(`${name}.png`, folder), await page.screenshot())
  }
} finally { await browser.close() }
