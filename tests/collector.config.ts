import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  testMatch: [
    'collector.spec.ts',
    'collector-built.spec.ts',
    'collector-live.spec.ts',
    'copy-tool.spec.ts',
    'launcher.spec.ts',
  ],
  workers: 1,
  timeout: 30000,
  use: { trace: 'off', launchOptions: { args: ['--no-proxy-server'] } },
});
