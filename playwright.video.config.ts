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
  testDir: './video',
  outputDir: './build.demo',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'line',
  timeout: 300000, // 5 minutes for slow scripted demos
  expect: {
    timeout: 5000,
  },
  use: {
    baseURL: 'http://localhost:25833',
    trace: 'on-first-retry',
    screenshot: 'off',
    actionTimeout: 5000,
    ignoreHTTPSErrors: true,
    viewport: { width: 450, height: 800 },
    video: {
      mode: 'on',
      size: { width: 450, height: 800 },
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        viewport: { width: 450, height: 800 },
        launchOptions: {
          args: ['--window-size=450,800'],
        },
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
        LIGHTLYNX_DEMO: 'true',
      },
    },
    {
      command: 'exec npm run dev -- --port 25833',
      port: 25833,
    },
  ],
});
