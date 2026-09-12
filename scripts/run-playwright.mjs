import { spawn } from 'node:child_process';
import path from 'node:path';

const child = spawn(
  process.execPath,
  [path.resolve('node_modules/@playwright/test/cli.js'), ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      NO_PROXY: `${process.env.NO_PROXY ?? ''},localhost,127.0.0.1,::1`,
      no_proxy: `${process.env.no_proxy ?? ''},localhost,127.0.0.1,::1`,
      PLAYWRIGHT_BROWSERS_PATH:
        process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.resolve('.cache/ms-playwright'),
    },
  },
);
child.on('error', () => {
  console.error('PLAYWRIGHT_START_FAILED');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
