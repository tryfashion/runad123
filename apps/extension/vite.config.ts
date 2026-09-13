import { defineConfig, loadEnv } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  const configured =
    process.env.RUNAD_API_ORIGIN ??
    loadEnv(mode, resolve(import.meta.dirname, '../..'), 'RUNAD_').RUNAD_API_ORIGIN;
  const apiOrigin = configured ?? 'http://127.0.0.1:3000';
  const url = new URL(apiOrigin);
  if (url.origin !== apiOrigin || !['http:', 'https:'].includes(url.protocol))
    throw new Error('INVALID_API_ORIGIN');
  if (mode === 'production') {
    const origin = configured;
    if (!origin || new URL(origin).protocol !== 'https:' || new URL(origin).origin !== origin) {
      throw new Error('RUNAD_API_ORIGIN must be an explicit HTTPS origin for a release build.');
    }
  }
  let outputDirectory = resolve(import.meta.dirname, 'dist');
  return {
    base: './',
    define: { __RUNAD_API_ORIGIN__: JSON.stringify(apiOrigin) },
    plugins: [
      {
        name: 'api-host-permission',
        configResolved(config) {
          outputDirectory = resolve(config.root, config.build.outDir);
        },
        closeBundle() {
          const manifest = JSON.parse(
            readFileSync(resolve(import.meta.dirname, 'public/manifest.json'), 'utf8'),
          );
          manifest.host_permissions = [apiOrigin + '/*'];
          manifest.externally_connectable = { matches: [apiOrigin + '/*'] };
          writeFileSync(
            resolve(outputDirectory, 'manifest.json'),
            JSON.stringify(manifest, null, 2),
          );
        },
      },
    ],
    build: {
      target: 'chrome120',
      sourcemap: mode === 'development',
      rolldownOptions: {
        input: {
          offscreen: resolve(import.meta.dirname, 'offscreen.html'),
          sidepanel: resolve(import.meta.dirname, 'sidepanel.html'),
          background: resolve(import.meta.dirname, 'src/background.ts'),
          detect: resolve(import.meta.dirname, 'src/detect.ts'),
        },
        output: { entryFileNames: '[name].js', chunkFileNames: 'assets/[name]-[hash].js' },
      },
    },
  };
});
