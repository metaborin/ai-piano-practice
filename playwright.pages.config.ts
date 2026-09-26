import { defineConfig } from '@playwright/test'
import config from './playwright.config'

const publishedUrl = process.env.PLAYWRIGHT_BASE_URL
const previewUrl = 'http://127.0.0.1:4174/ai-piano-practice/'

/** Run the practice checks against dist or the published HTTPS site. */
export default defineConfig({
  ...config,
  testDir: './tests',
  testMatch: ['e2e/**/*.spec.ts', 'pages/**/*.spec.ts'],
  use: { ...config.use, baseURL: publishedUrl ?? previewUrl },
  webServer: publishedUrl ? undefined : {
    command: 'npm run preview -- --host 127.0.0.1 --port 4174 --strictPort',
    url: previewUrl,
    reuseExistingServer: !process.env.CI,
  },
})
