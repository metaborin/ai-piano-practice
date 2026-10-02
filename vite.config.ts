import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { pdfAssets } from './pdfAssets.ts'

// https://vite.dev/config/
export default defineConfig({
  base: '/ai-piano-practice/',
  plugins: [react(), pdfAssets()],
})
