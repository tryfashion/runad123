import { test, expect } from '@playwright/test';

test('language selection persists, manual wins, auto follows browser', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-TW' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:3000/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('商品工作台');
  await page.getByRole('combobox').selectOption('en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Product workspace');
  await page.goto('http://127.0.0.1:3000/?lang=zh-Hans');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Product workspace');
  await page.getByRole('combobox').selectOption('auto');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant');
  await expect(page).not.toHaveURL(/lang=/);
  await expect(page.locator('.empty-product a')).toHaveAttribute('href', '/guide?lang=zh-Hant');
  await page.screenshot({ path: 'artifacts/web-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: 'artifacts/web-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
});

test('health endpoints distinguish alive from ready', async ({ request }) => {
  const live = await request.get('/health/live');
  expect(live.status()).toBe(200);
  const ready = await request.get('/health/ready');
  expect(ready.status()).toBe(503);
  expect((await ready.json()).error.code).toBe('SERVICE_NOT_READY');
});
