
import { defineConfig, devices } from '@playwright/test';
import { execSync } from 'child_process';

// Make sure there are no hanging server processes from previous test runs.
// As the config is reread by workers, we need to take care to only do this once,
// or we might kill newly started servers.
if (!process.env.PW_CLEANUP_DONE) {
  process.env.PW_CLEANUP_DONE = '1';
  for (const port of [25833, 43598]) {
    try {
      execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' });
    } catch {}
  }
}

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/*.spec.ts'], // Include both tests/ and video/ directories
  outputDir: './tests-out',  // Our custom test framework manages this
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
      env: {
        LIGHTLYNX_PORT: '43598',
        LIGHTLYNX_INSECURE: 'true',
        LIGHTLYNX_ALLOW_RESETS: 'true', // Allow resetting the mock server state via API
      },
    },
    {
      command: 'exec npm run dev -- --port 25833',
      port: 25833,
    },
  ],
});
