import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('starts without credentials and releases timers on its shutdown handler', () => {
  const output = execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      "await import('./apps/worker/src/index.ts'); setTimeout(() => process.emit('SIGTERM'), 100);",
    ],
    {
      timeout: 10000,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, MYSQL_URL: '', NODE_ENV: 'test' },
    },
  );
  const events = output
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(events.map((event) => event.event)).toEqual(['worker.started', 'worker.stopped']);
  expect(events[0].taskProcessing).toBe(false);
  expect(events[0].databaseConfigured).toBe(false);
}, 15000);
