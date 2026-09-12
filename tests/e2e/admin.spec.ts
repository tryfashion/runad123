import { test, expect, type BrowserContext } from '@playwright/test';
import { m6Fixture } from '../support/m6-fixture.js';
import { MemoryAuthStore } from '../support/memory-auth-store.js';
import { createAuthHandler } from '../../packages/server-core/src/index.js';
import { randomUUID } from 'node:crypto';
test.use({ trace: 'off' });
async function setup(context: BrowserContext) {
  const store = new MemoryAuthStore(),
    f = await m6Fixture(store),
    handler = createAuthHandler(f.auth, {
      webOrigin: 'http://127.0.0.1:3000',
      extensionIds: [],
      production: false,
    });
  await context.route('**/api/v1/**', async (route) => {
    const r = route.request(),
      response = await handler(
        new Request(r.url(), {
          method: r.method(),
          headers: await r.allHeaders(),
          ...(r.postData() ? { body: r.postData()! } : {}),
        }),
      );
    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) headers['set-cookie'] = cookies.join('\n');
    await route.fulfill({ status: response.status, headers, body: await response.text() });
  });
  return { ...f, store };
}
test('M6 public tutorials follow language, retain original article language and show safe unknown errors', async ({
  page,
  context,
}) => {
  const f = await setup(context);
  await f.admin.saveTutorial(
    undefined,
    {
      title: 'Importing a product with multiple variants — ' + 'detailed guidance '.repeat(6),
      summary: 'Compare currency, images and draft status before publishing. '.repeat(6),
      url: 'https://learn.example.com/import',
      contentLocale: 'en',
      category: 'shopify',
      placement: 'both',
      sortOrder: 0,
      enabled: true,
    },
    f.root.credential.token,
    randomUUID(),
  );
  await page.goto('/tutorials?lang=en');
  await expect(page.locator('.content-card article')).toHaveCount(1);
  await page.getByRole('combobox').selectOption('zh-Hant');
  await expect(page.getByText('原文語言: en')).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/m6-tutorials-mobile.png', fullPage: true });
  await context.route('**/api/v1/tutorials?**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'NEW_SERVER_ERROR' },
        requestId: 'fixture-request-id',
      }),
    }),
  );
  await page.reload();
  await expect(page.getByRole('status')).toContainText('fixture-request-id');
  await expect(page.getByRole('status')).toContainText('服務暫時無法使用');
  await page.goto('/guide');
  await expect(page.locator('.guide-steps p')).toHaveCount(5);
  await page.goto('/privacy');
  await expect(page.locator('.content-card')).toContainText('30 天');
});
test('M6 administrator can edit limits and tutorials; deletion needs explicit confirmation and displays completion', async ({
  page,
  context,
}) => {
  const f = await setup(context);
  await context.addCookies([
    {
      name: 'runad-session',
      value: f.root.credential.token,
      url: 'http://127.0.0.1:3000',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto('/admin?lang=en');
  const card = page.locator('.admin-card');
  await expect(card.getByLabel('Global daily budget (USD)', { exact: true })).toHaveValue('100');
  await card.getByLabel('Global daily budget (USD)', { exact: true }).fill('2.500000');
  await card.locator('form').first().getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(
      () =>
        (
          f.store.rows.settings.find((s) => s.key === 'ai_risk')!.valueJson as {
            dailyBudget: string;
          }
        ).dailyBudget,
    )
    .toBe('2.500000');
  await card.getByLabel('Title', { exact: true }).fill('New import tutorial');
  await card.getByLabel('Article URL', { exact: true }).fill('https://learn.example.com/new');
  await card.getByLabel('Enabled', { exact: true }).check();
  await card.locator('form').nth(1).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card.getByText('New import tutorial', { exact: true })).toBeVisible();
  await expect(card.locator('.metrics')).toContainText('Unknown');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/m6-admin-mobile.png', fullPage: true });
  await page.goto('/account?lang=en');
  const button = page.getByRole('button', { name: 'Delete my collected and AI data', exact: true });
  await expect(button).toBeDisabled();
  await page.getByRole('checkbox').check();
  await button.click();
  await expect(
    page.getByText('Deletion is queued or running; new business operations are paused', {
      exact: true,
    }),
  ).toBeVisible();
  expect(f.store.rows.deletions).toHaveLength(1);
  for (let i = 0; i < 20; i++) await f.maintenance.personalBatch();
  await page
    .locator('section')
    .filter({ has: button })
    .last()
    .getByRole('button', { name: 'Refresh', exact: true })
    .click();
  await expect(page.getByText('Data deletion completed', { exact: true })).toBeVisible();
});
