
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:25833',
    trace: 'on-first-retry',
    screenshot: 'on',
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm run mock-z2m',
      port: 43597,
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev -- --port 25833',
      port: 25833,
      reuseExistingServer: false,
    },
  ],
});
