import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import net from 'node:net';
const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);
const [role, action] = process.argv.slice(2);
if (!['frontend', 'backend'].includes(role) || !['prepare', 'run'].includes(action))
  throw Error('INVALID_COMMAND');
if (existsSync('.env')) process.loadEnvFile('.env');
process.env.NODE_ENV = 'development';
process.env.NEXT_TELEMETRY_DISABLED = '1';
if (process.env.LOCAL_PREVIEW_ENABLED === 'true') process.env.DEEPSEEK_API_KEY = '';
const origin = 'http://127.0.0.1:3000';
const require = createRequire(import.meta.url);
function launch(args, cwd = root) {
  return spawn(process.execPath, args, { cwd, stdio: 'inherit', windowsHide: true });
}
function done(child) {
  return new Promise((resolve, reject) => {
    child.once('error', () => reject(Error('PROCESS_START_FAILED')));
    child.once('exit', (code) => (code === 0 ? resolve() : reject(Error('PROCESS_EXIT_' + code))));
  });
}
try {
  if (process.env.WEB_ORIGIN && process.env.WEB_ORIGIN !== origin)
    throw Error('LOCAL_ORIGIN_REQUIRED');
  if (process.env.RUNAD_API_ORIGIN && process.env.RUNAD_API_ORIGIN !== origin)
    throw Error('LOCAL_ORIGIN_REQUIRED');
  if (action === 'prepare') {
    const tsc = require.resolve('typescript/lib/tsc.js');
    for (const project of [
      'packages/contracts',
      'packages/db',
      'packages/product-core',
      'packages/server-core',
      ...(role === 'backend' ? ['apps/worker'] : []),
    ]) {
      console.log('Building ' + project);
      await done(launch([tsc, '-p', path.join(root, project, 'tsconfig.json')]));
    }
    if (role === 'frontend')
      await done(
        launch(
          [
            path.join(root, 'apps/extension/node_modules/vite/bin/vite.js'),
            'build',
            '--mode',
            'development',
          ],
          path.join(root, 'apps/extension'),
        ),
      );
  } else if (role === 'backend') {
    console.log('Backend worker. Close this window to stop.');
    await done(launch([path.join(root, 'apps/worker/dist/index.js')]));
  } else {
    await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', () => reject(Error('PORT_3000_IN_USE')));
      probe.listen(3000, '127.0.0.1', () => probe.close(resolve));
    });
    console.log('Frontend + API: ' + origin + ' | Close this window to stop.');
    console.log('Chrome extension: ' + path.join(root, 'apps/extension/dist'));
    const web = launch(
      [
        path.join(root, 'apps/web/node_modules/next/dist/bin/next'),
        'dev',
        '--webpack',
        '--hostname',
        '127.0.0.1',
        '--port',
        '3000',
      ],
      path.join(root, 'apps/web'),
    );
    const completion = done(web);
    void completion.catch(() => {});
    if (process.env.RUNAD_SKIP_OPEN !== '1') {
      for (let i = 0; i < 60 && web.exitCode === null; i++) {
        try {
          const response = await fetch(origin + '/health/live', {
            signal: AbortSignal.timeout(1000),
          });
          if (response.ok && (await response.json()).data?.status === 'alive') {
            spawn(
              'powershell.exe',
              [
                '-NoProfile',
                '-WindowStyle',
                'Hidden',
                '-Command',
                'Start-Process',
                origin + '/admin/login?lang=zh-Hans',
              ],
              { stdio: 'ignore', windowsHide: true },
            ).unref();
            break;
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    await completion;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
