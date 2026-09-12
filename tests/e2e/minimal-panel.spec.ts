import { chromium, test, expect } from '@playwright/test';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeShopify } from '../../packages/product-core/src/index.js';
import { prepareProduct } from '../../packages/server-core/src/products.js';

test.use({ trace: 'off' });
test('minimal home previews locally and creates anonymous identity only when saving (simulated collection/API)', async () => {
  await mkdir('artifacts', { recursive: true });
  const profile = await mkdtemp(path.resolve('artifacts/minimal-panel-'));
  const extension = path.resolve('apps/extension/dist');
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
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const product = normalizeShopify(
      await readFile('tests/fixtures/shopify-ajax-multi.json', 'utf8'),
      {
        pageUrl: 'https://fixture.example/products/runad123-probe-trail-mug',
        currency: 'USD',
        method: 'ajax_js',
      },
    );
    const draft = prepareProduct(
      product,
      { targetCountry: 'US', language: 'preserve' },
      crypto.randomUUID(),
      1,
    );
    await worker.evaluate(
      async ({ draft }) => {
        const calls: string[] = [];
        (globalThis as typeof globalThis & { previewCalls?: string[] }).previewCalls = calls;
        const installationId = crypto.randomUUID(),
          expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
        globalThis.fetch = async (input, init) => {
          const url = new URL(String(input));
          calls.push(url.pathname);
          const response = (data: unknown) => Response.json({ data });
          if (url.pathname.endsWith('/config'))
            return response({
              accessMode: 'anonymous_allowed',
              configVersion: 1,
              consentVersion: '2026-09-12',
              supportedUiLocales: ['en', 'zh-Hans', 'zh-Hant'],
              defaultUiLocale: 'en',
              protocolVersion: 1,
            });
          if (url.pathname.endsWith('/installations')) {
            const input = JSON.parse(String(init?.body));
            if (input.consentAccepted !== true) return Response.json({}, { status: 400 });
            return response({ token: 'a'.repeat(64), installationId, expiresAt });
          }
          if (url.pathname.endsWith('/me'))
            return response({
              user: null,
              installationId,
              loginRequired: false,
              expiresAt,
              quota: null,
            });
          if (url.pathname.endsWith('/captures')) return response({ preparedRevision: draft });
          if (url.pathname.includes('/drafts/'))
            return Response.json({ error: { code: 'AI_UNAVAILABLE' } }, { status: 503 });
          return Response.json({}, { status: 404 });
        };
        await chrome.storage.local.set({ uiLocalePreference: 'zh-Hans' });
      },
      { draft },
    );
    const page = await context.newPage();
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
    await expect(page.locator('.account')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '采集当前商品', exact: true })).toBeEnabled();
    expect(
      await worker.evaluate(
        () => (globalThis as typeof globalThis & { previewCalls?: string[] }).previewCalls,
      ),
    ).toEqual([]);
    await page.screenshot({ path: 'artifacts/plugin-simple-home.png', fullPage: true });
    await page.evaluate((product) => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = ((message: { action: string }) =>
        message.action === 'collect'
          ? Promise.resolve({ ok: true, data: { product } })
          : send(message)) as typeof chrome.runtime.sendMessage;
      chrome.tabs.query = (() =>
        Promise.resolve([
          { id: 123, url: 'https://fixture.example/products/runad123-probe-trail-mug' },
        ])) as unknown as typeof chrome.tabs.query;
      chrome.permissions.request = (() =>
        Promise.resolve(true)) as typeof chrome.permissions.request;
    }, product);
    await page.getByRole('button', { name: '采集当前商品', exact: true }).click();
    await expect(page.locator('.product-summary h2')).toHaveText(product.title);
    expect(await worker.evaluate(async () => !!(await chrome.storage.local.get('auth')).auth)).toBe(
      false,
    );
    await page.getByLabel('目标销售国家（两位代码）').fill('US');
    await page.getByRole('button', { name: '教程', exact: true }).click();
    await page.getByRole('button', { name: '产品', exact: true }).click();
    await expect(page.getByLabel('目标销售国家（两位代码）')).toHaveValue('US');
    await expect(page.locator('.consent-note')).toBeVisible();
    await page.getByRole('button', { name: '创建草稿', exact: true }).click();
    await expect(page.getByLabel('标题', { exact: true })).toHaveValue(product.title);
    const calls = await worker.evaluate(
      () => (globalThis as typeof globalThis & { previewCalls?: string[] }).previewCalls!,
    );
    expect(calls.filter((p) => p.endsWith('/installations'))).toHaveLength(1);
    expect(calls.filter((p) => p.endsWith('/captures'))).toHaveLength(1);
    await page.getByLabel('标题', { exact: true }).fill('Unsaved test title');
    await page.getByRole('link', { name: '账号 / 登录' }).click();
    await expect(page.locator('.account')).toBeVisible();
    await page.getByRole('button', { name: '← 返回产品' }).click();
    await expect(page.getByLabel('标题', { exact: true })).toHaveValue('Unsaved test title');
    for (const width of [280, 360, 440]) {
      await page.setViewportSize({ width, height: 780 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  } finally {
    await context.close();
    if (!profile.startsWith(path.resolve('artifacts') + path.sep)) throw Error('UNSAFE_PROFILE');
    await rm(profile, { recursive: true, force: true });
  }
});
