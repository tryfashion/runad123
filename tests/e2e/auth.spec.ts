import { test, expect } from '@playwright/test';
import {
  AuthService,
  createMemoryMailer,
  createAuthHandler,
  secretToken,
} from '../../packages/server-core/src/index.js';
import { MemberService } from '../../packages/server-core/src/member.js';
import { m6Fixture } from '../support/m6-fixture.js';
import { randomUUID } from 'node:crypto';
import { MemoryAuthStore } from '../support/memory-auth-store.js';

test.use({ trace: 'off' });

test('reviewed password website login with simulated database, real cookie/CSRF flow', async ({
  page,
  context,
}) => {
  const store = new MemoryAuthStore(),
    mailer = createMemoryMailer('test');
  const fixture = await m6Fixture(store);
  const auth = new AuthService(store, mailer, secretToken());
  const members = new MemberService(auth);
  const handler = createAuthHandler(auth, {
    webOrigin: test.info().project.use.baseURL ?? 'http://127.0.0.1:3000',
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
  await page.getByLabel('Password', { exact: true }).fill('Synthetic-pass-42');
  await page.getByLabel('Confirm password', { exact: true }).fill('Synthetic-pass-42');
  await expect(page.locator('textarea')).toHaveCount(0);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Register', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Application submitted' })).toBeVisible();
  await members.review(
    store.rows.members[0]!.id,
    { decision: 'approved' },
    fixture.root.credential.token,
    randomUUID(),
  );
  await page.getByRole('button', { name: 'Go to sign in', exact: true }).click();
  await page.getByLabel('Password', { exact: true }).fill('Synthetic-pass-42');
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await expect(page.getByText('browser@example.com', { exact: true })).toBeVisible();
  const cookies = await context.cookies();
  expect(cookies.find((cookie) => cookie.name === 'runad-session')?.httpOnly).toBe(true);
  await page.reload();
  await expect(page.getByText('browser@example.com', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  expect(store.rows.sessions.at(-1)!.revokedAt !== null).toBe(true);
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

test('administrator reviews registration requests through the real admin UI and service', async ({
  page,
  context,
}) => {
  const store = new MemoryAuthStore();
  const f = await m6Fixture(store),
    members = new MemberService(f.auth);
  const origin = test.info().project.use.baseURL ?? 'http://127.0.0.1:3000';
  await members.register(
    {
      email: 'reviewer-test@example.com',
      password: 'Synthetic-pass-42',
      confirmPassword: 'Synthetic-pass-42',
      purpose: '独立站选品研究与产品导出',
      consentAccepted: true,
    },
    'test-ip',
  );
  const handler = createAuthHandler(f.auth, {
    webOrigin: origin,
    extensionIds: [],
    production: false,
  });
  await context.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const response = await handler(
      new Request(request.url(), {
        method: request.method(),
        headers: await request.allHeaders(),
        ...(request.postData() ? { body: request.postData()! } : {}),
      }),
    );
    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      headers[k] = v;
    });
    if (response.headers.getSetCookie().length)
      headers['set-cookie'] = response.headers.getSetCookie().join('\n');
    await route.fulfill({ status: response.status, headers, body: await response.text() });
  });
  await context.addCookies([
    {
      name: 'runad-session',
      value: f.root.credential.token,
      url: origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto('/admin?lang=zh-Hans');
  await page.getByRole('menuitem', { name: /账号管理/ }).click();
  const card = page
    .locator('.ant-card')
    .filter({ has: page.getByText('注册审核', { exact: true }) });
  await expect(card.getByText('reviewer-test@example.com', { exact: true })).toBeVisible();
  await expect(card.getByText('邮箱未验证', { exact: true })).toBeVisible();
  await card.getByLabel('审核备注（可选）').fill('用途清楚，同意试用');
  await page.screenshot({ path: 'artifacts/registration-admin-review.png', fullPage: true });
  await card.getByRole('button', { name: /^通\s*过$/ }).click();
  await page.getByRole('button', { name: /^确\s*认$/ }).click();
  await expect.poll(() => store.rows.members[0]!.state).toBe('approved');
  expect(store.rows.users.at(-1)!.role).toBe('user');
  await expect(card.getByText('reviewer-test@example.com', { exact: true })).toHaveCount(0);
});
