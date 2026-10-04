import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: 2,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173/ai-piano-practice/',
    viewport: { width: 1280, height: 800 },
    // Network-failure tests must reach their routes, not a precache. PWA tests opt in.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173/ai-piano-practice/',
    reuseExistingServer: !process.env.CI,
  },
})
