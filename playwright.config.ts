
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'line',
  timeout: 60000,
  expect: {
    timeout: 5000,
  },
  use: {
    baseURL: 'http://localhost:25833',
    trace: 'on-first-retry',
    screenshot: 'off', // We capture our own screenshots
    actionTimeout: 5000,
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 450, height: 800 },
      },
    },
  ],
  webServer: [
    {
      command: 'exec npm run mock-z2m',
      port: 43598,
      reuseExistingServer: false,
      env: {
        MOCK_Z2M_PORT: '43598',
        MOCK_Z2M_INSECURE: 'true',
      },
    },
    {
      command: 'exec npm run dev -- --port 25833',
      port: 25833,
      reuseExistingServer: false,
    },
  ],
});
