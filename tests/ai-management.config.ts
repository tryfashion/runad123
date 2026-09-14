import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  testMatch: ['ai-management.spec.ts'],
  workers: 1,
  timeout: 60000,
  use: {
    trace: 'off',
    baseURL: 'http://127.0.0.1:3107',
    launchOptions: { args: ['--no-proxy-server'] },
  },
  webServer: {
    command: 'pnpm --filter @runad123/web exec next start --hostname 127.0.0.1 --port 3107',
    url: 'http://127.0.0.1:3107/admin',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
