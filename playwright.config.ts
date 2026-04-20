
import { defineConfig } from 'shotest';

export default defineConfig({
    workers: 1,
    timeout: 60000,
    expect: {
        timeout: 8000,
    },
    use: {
        baseURL: 'http://localhost:25833',
        trace: 'on-first-retry',
        screenshot: 'off', // We capture our own screenshots
        ignoreHTTPSErrors: true,
        viewport: { width: 450, height: 800 },
    },
    webServer: [
        {
            command: 'lsof -ti:43598 | xargs kill -9 2>/dev/null ; exec npm run mock-z2m',
            port: 43598,
        },
        {
            command: 'lsof -ti:25833 | xargs kill -9 2>/dev/null ; exec npm run dev -- --port 25833',
            port: 25833,
        },
    ],
});
