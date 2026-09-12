import { chromium, test, expect } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

test('packaged extension runs and remembers language after restart', async () => {
  const extension = path.resolve('apps/extension/dist');
  await mkdir(path.resolve('artifacts'), { recursive: true });
  const profile = await mkdtemp(path.resolve('artifacts/extension-test-'));
  const launch = () =>
    chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      args: [
        '--no-proxy-server',
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    });
  let context = await launch();
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    await context.route('**/api/v1/tutorials?**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            items: [
              {
                id: 'e28ac341-8d53-4b09-98a8-7b62d5716111',
                version: 1,
                title: 'Synthetic import tutorial',
                summary: 'Check currency and draft status.',
                url: 'https://learn.example.com/import',
                contentLocale: 'en',
                category: 'shopify',
                placement: 'both',
                sortOrder: 0,
                enabled: true,
              },
            ],
            nextCursor: null,
          },
        }),
      }),
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`chrome-extension://${id}/sidepanel.html`);
    await page.getByRole('combobox').selectOption('zh-Hant');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant');
    await expect(page.locator('.account')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '擷取目前商品', exact: true })).toBeEnabled();
    expect(await worker.evaluate(async () => !!(await chrome.storage.local.get('auth')).auth)).toBe(
      false,
    );
    await page.getByRole('button', { name: '教學', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Synthetic import tutorial ↗' })).toHaveAttribute(
      'href',
      'https://learn.example.com/import',
    );
    await expect(page.locator('.tutorial-panel').getByText('原文語言: en')).toBeVisible();
    await expect(page.getByRole('link', { name: '前往教學網站 ↗' })).toHaveAttribute(
      'href',
      /lang=zh-Hant&ut[m]_source=extension/,
    );
    await expect
      .poll(() =>
        worker.evaluate(
          async () => (await chrome.storage.local.get('uiLocalePreference')).uiLocalePreference,
        ),
      )
      .toBe('zh-Hant');
    await page.getByRole('button', { name: '產品', exact: true }).click();
    await page.setViewportSize({ width: 360, height: 780 });
    await page.screenshot({ path: 'artifacts/extension-panel.png', fullPage: true });
    expect(errors).toEqual([]);
    await context.close();
    context = await launch();
    const restored = await context.newPage();
    await restored.goto(`chrome-extension://${id}/sidepanel.html`);
    await expect(restored.getByRole('combobox')).toHaveValue('zh-Hant');
    await expect(restored.getByRole('button', { name: '擷取目前商品', exact: true })).toBeEnabled();
    await expect(restored.locator('.account')).toHaveCount(0);
    await restored.getByRole('link', { name: '帳號 / 登入' }).click();
    await expect(restored.locator('.account')).toBeVisible();
    await restored.getByRole('button', { name: '← 返回產品' }).click();
    await expect(restored.locator('.account')).toHaveCount(0);
    await restored.getByRole('combobox').selectOption('auto');
    await expect(restored.getByRole('combobox')).toHaveValue('auto');
  } finally {
    await context.close();
    // The generated path is verified within our artifact directory before removal.
    const root = path.resolve('artifacts') + path.sep;
    if (!profile.startsWith(root)) throw new Error('Unsafe test profile path');
    await rm(profile, { recursive: true, force: true });
  }
});
