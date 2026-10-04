import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { pdfAssets } from './pdfAssets.ts'
import { VitePWA } from 'vite-plugin-pwa'
import { APP_BASE, pwaOptions } from './pwa.config.ts'

// https://vite.dev/config/
export default defineConfig({
  base: APP_BASE,
  plugins: [react(), pdfAssets(), VitePWA(pwaOptions)],
})
