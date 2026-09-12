import { chromium, test, expect } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { readWebsite } from '../../apps/extension/src/website-overview.js';
test.use({ trace: 'off' });
test('website tab is second and lazy; DOM metadata, missing fields and return navigation', async () => {
  await mkdir('artifacts', { recursive: true });
  const profile = await mkdtemp(path.resolve('artifacts/overview-'));
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
    const fixture = await context.newPage();
    await fixture.setContent(
      '<html lang="en"><head><meta property="og:site_name" content="Fixture store"></head><body></body></html>',
    );
    await fixture.evaluate(() =>
      Object.assign(window, {
        Shopify: {
          shop: 'fixture.myshopify.com',
          currency: { active: 'USD' },
          country: 'US',
          theme: { name: 'Fixture theme' },
        },
      }),
    );
    const read = await fixture.evaluate(readWebsite);
    expect(read).toMatchObject({
      name: 'Fixture store',
      shopify: true,
      currency: 'USD',
      theme: 'Fixture theme',
      language: 'en',
    });
    await fixture.evaluate(() => {
      delete (window as typeof window & { Shopify?: unknown }).Shopify;
    });
    expect(await fixture.evaluate(readWebsite)).toMatchObject({
      shopify: false,
      theme: '',
      currency: '',
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await worker.evaluate(() => chrome.storage.local.set({ uiLocalePreference: 'zh-Hans' }));
    let affiliateEnabled = true;
    await context.route('**/api/v1/theme-link?**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            link: affiliateEnabled
              ? { name: 'Fixture theme', url: 'https://themes.example/buy?ref=runad123' }
              : null,
          },
        }),
      }),
    );
    const page = await context.newPage();
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
    await expect(page.locator('.panel-tabs button')).toHaveText([
      '产品',
      '网站概览',
      '教程',
      '工具',
    ]);
    await expect(page.locator('.website-panel')).toHaveCount(0);
    await page.evaluate((read) => {
      const tab = { id: 123, active: true, url: 'https://fixture.example/products/mug' };
      chrome.tabs.query = (() => Promise.resolve([tab])) as unknown as typeof chrome.tabs.query;
      chrome.tabs.get = (() => Promise.resolve(tab)) as unknown as typeof chrome.tabs.get;
      chrome.scripting.executeScript = (() =>
        Promise.resolve([
          {
            result: {
              ...read,
              host: 'fixture.example',
              url: 'https://fixture.example',
              pageUrl: tab.url,
            },
          },
        ])) as unknown as typeof chrome.scripting.executeScript;
    }, read);
    await page.getByRole('button', { name: '网站概览', exact: true }).click();
    await expect(page.locator('.website-panel')).toBeVisible();
    await expect(page.getByText('Fixture store', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Fixture theme ↗', exact: true })).toHaveAttribute(
      'href',
      'https://themes.example/buy?ref=runad123',
    );
    await expect(page.locator('.affiliate-label')).toHaveText('推广链接');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: 'artifacts/website-overview.png', fullPage: true });
    await page.getByRole('button', { name: '产品', exact: true }).click();
    await expect(page.getByRole('button', { name: '采集当前商品', exact: true })).toBeVisible();
    await expect(page.locator('.website-panel')).toHaveCount(0);
    affiliateEnabled = false;
    await page.evaluate(() => {
      chrome.scripting.executeScript = (() =>
        Promise.reject(Error('permission denied'))) as typeof chrome.scripting.executeScript;
    });
    await page.getByRole('button', { name: '网站概览', exact: true }).click();
    // Script now rejects: a same-day revisit must succeed entirely from persisted cache.
    await expect(page.getByText('Fixture theme', { exact: true })).toBeVisible();
    await expect(page.getByText('请允许访问当前网站，以读取网站概览。')).toHaveCount(0);
    await page.getByRole('button', { name: '产品', exact: true }).click();
    await worker.evaluate(async () => {
      const key = 'websiteOverview:v1:https://fixture.example';
      const stored = await chrome.storage.local.get(key);
      const entry = stored[key] as { savedAt: number };
      entry.savedAt = Date.now() - 86400000;
      await chrome.storage.local.set({ [key]: entry });
    });
    await page.getByRole('button', { name: '网站概览', exact: true }).click();
    await expect(page.getByText('请允许访问当前网站，以读取网站概览。')).toBeVisible();
    // Failed refresh retains old content and does not move its cache date forward.
    await expect(page.getByText('Fixture theme', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '产品', exact: true }).click();
    await expect(page.getByRole('button', { name: '采集当前商品', exact: true })).toBeEnabled();
  } finally {
    await context.close();
    if (!profile.startsWith(path.resolve('artifacts') + path.sep)) throw Error('UNSAFE_PROFILE');
    await rm(profile, { recursive: true, force: true });
  }
});
