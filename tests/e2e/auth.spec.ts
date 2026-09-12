import { test, expect } from '@playwright/test';
import {
  AuthService,
  createMemoryMailer,
  createAuthHandler,
  secretToken,
} from '../../packages/server-core/src/index.js';
import { MemoryAuthStore } from '../support/memory-auth-store.js';

test.use({ trace: 'off' });

test('website login form with simulated database and mail, real cookie/CSRF flow', async ({
  page,
  context,
}) => {
  const store = new MemoryAuthStore(),
    mailer = createMemoryMailer('test');
  const handler = createAuthHandler(new AuthService(store, mailer, secretToken()), {
    webOrigin: 'http://127.0.0.1:3000',
    extensionIds: [],
    production: false,
  });
  await context.route('**/api/v1/**', async (route) => {
    const request = route.request(),
      headers = await request.allHeaders();
    const response = await handler(
      new Request(request.url(), {
        method: request.method(),
        headers,
        ...(request.postData() ? { body: request.postData()! } : {}),
      }),
    );
    const resultHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      resultHeaders[key] = value;
    });
    // Preserve separate Set-Cookie fields through Playwright's header string representation.
    const cookies = response.headers.getSetCookie();
    if (cookies.length) resultHeaders['set-cookie'] = cookies.join('\n');
    await route.fulfill({
      status: response.status,
      headers: resultHeaders,
      body: await response.text(),
    });
  });
  await page.goto('/account?lang=en');
  await page.getByLabel('Email', { exact: true }).fill('browser@example.com');
  await page.getByRole('button', { name: 'Send code', exact: true }).click();
  await expect(page.getByText('Code sent. Check your inbox.', { exact: true })).toBeVisible();
  await page.getByLabel('Verification code', { exact: true }).fill(mailer.outbox[0]!.code);
  await page.getByRole('button', { name: 'Sign in / Register', exact: true }).click();
  await expect(page.getByText('browser@example.com', { exact: true })).toBeVisible();
  const cookies = await context.cookies();
  expect(cookies.find((cookie) => cookie.name === 'runad-session')?.httpOnly).toBe(true);
  await page.reload();
  await expect(page.getByText('browser@example.com', { exact: true })).toBeVisible();
  await page.goto('/admin?lang=en');
  await expect(
    page.getByText('You do not have permission to perform this action.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  expect(store.rows.sessions[0]!.revokedAt !== null).toBe(true);
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/m1-account-mobile.png', fullPage: true });
});

test('unconfigured real API reports unavailable without claiming login success', async ({
  request,
  page,
}) => {
  const response = await request.get('/api/v1/config');
  expect(response.status()).toBe(503);
  expect((await response.json()).error.code).toBe('SERVICE_NOT_READY');
  await page.goto('/account?lang=zh-Hans');
  await expect(page.getByText('服务尚未配置或暂时不可用。', { exact: true })).toBeVisible();
});
