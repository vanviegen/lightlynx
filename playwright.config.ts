
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:25833',
    trace: 'on-first-retry',
    screenshot: 'on',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'MOCK_Z2M_PORT=25834 npm run mock-z2m',
      port: 25834,
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev -- --port 25833',
      port: 25833,
      reuseExistingServer: false,
    },
  ],
});
