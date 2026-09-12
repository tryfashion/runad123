import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--no-proxy-server'] },
  },
  webServer: {
    command: 'pnpm --filter @runad123/web start',
    url: 'http://127.0.0.1:3000/health/live',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
