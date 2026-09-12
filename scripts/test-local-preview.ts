import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openLocalAdmin, validateLocalPreview } from './open-local-admin.js';
process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.cache/ms-playwright');
process.env.NO_PROXY = 'localhost,127.0.0.1,::1';
const { chromium } = await import('@playwright/test');
validateLocalPreview(process.env);
for (const patch of [
  { NODE_ENV: 'production' },
  { LOCAL_PREVIEW_ENABLED: 'false' },
  { MYSQL_URL: 'mysql://user:password@example.com/database' },
  { WEB_ORIGIN: 'https://example.com' },
])
  assert.throws(() => validateLocalPreview({ ...process.env, ...patch }));
assert.equal((await fetch('http://127.0.0.1:3000/api/v1/admin/overview')).status, 401);
await mkdir(resolve('artifacts'), { recursive: true });
const profile = await mkdtemp(resolve('artifacts/local-preview-'));
const extension = resolve('apps/extension/dist');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  args: [
    '--no-proxy-server',
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
});
try {
  const page = await context.newPage();
  await openLocalAdmin(async (url) => {
    const invalid = await fetch(new URL('/invalid', url));
    assert.equal(invalid.status, 404);
    assert.equal(invalid.headers.get('set-cookie'), null);
    await page.goto(url);
    assert.equal((await fetch(url, { redirect: 'manual' })).status, 404);
  });
  await page.waitForURL('**/admin?lang=zh-Hans');
  assert.equal(
    await page.evaluate(async () => (await fetch('/api/v1/admin/overview')).status),
    200,
  );
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'artifacts/local-admin-preview.png', fullPage: true });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  assert.match(id, /^[a-p]{32}$/);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await panel.getByRole('combobox').selectOption('zh-Hans');
  assert.equal(await panel.locator('.account').count(), 0);
  await panel.getByRole('link', { name: '账号 / 登录' }).click();
  await panel.locator('.account input[type=checkbox]').check();
  await panel.locator('.account button').first().click();
  await panel.waitForFunction(async () => {
    const response = await chrome.runtime.sendMessage({ action: 'status' });
    return response.ok && response.data.me?.installationId;
  });
  await panel.screenshot({ path: 'artifacts/local-extension-preview.png', fullPage: true });
  console.log(
    'PASS: local-only guards; anonymous admin rejected; one-use bridge; real MySQL admin API; Chrome-assigned ID; real extension anonymous installation. No API mocks or AI calls.',
  );
  // The isolated profile is removed below; its server session expires after one hour.
} finally {
  await context.close();
  if (!profile.startsWith(resolve('artifacts') + '\\')) throw Error('UNSAFE_PROFILE_PATH');
  await rm(profile, { recursive: true, force: true });
}
