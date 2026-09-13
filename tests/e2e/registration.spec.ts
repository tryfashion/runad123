import { chromium, test, expect } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

test('real extension application and reviewed login bridge with simulated API', async () => {
  await mkdir('artifacts', { recursive: true });
  const profile = await mkdtemp(path.resolve('artifacts/registration-profile-'));
  const extension = path.resolve('artifacts/registration-extension');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [
      '--no-proxy-server',
      '--disable-extensions-except=' + extension,
      '--load-extension=' + extension,
    ],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await worker.evaluate(() => {
      const config = {
        accessMode: 'anonymous_allowed',
        configVersion: 1,
        consentVersion: '2026-09-12',
        supportedUiLocales: ['zh-Hans', 'zh-Hant', 'en'],
        defaultUiLocale: 'en',
        protocolVersion: 1,
      };
      const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
      const installationId = '11111111-1111-4111-8111-111111111111';
      globalThis.fetch = (async (input, init) => {
        const path = new URL(String(input)).pathname;
        const token = new Headers(init?.headers).get('Authorization');
        const user =
          token === 'Bearer ' + 'u'.repeat(64)
            ? {
                id: '22222222-2222-4222-8222-222222222222',
                email: 'test@example.com',
                role: 'user',
              }
            : null;
        let data: unknown;
        if (path.endsWith('/config')) data = config;
        else if (path.endsWith('/installations'))
          data = { token: 't'.repeat(64), installationId, expiresAt };
        else if (path.endsWith('/me'))
          data = { user, installationId, expiresAt, loginRequired: false, quota: null };
        else if (path.endsWith('/auth/registration')) {
          if (!(globalThis as unknown as { allowRegistration?: boolean }).allowRegistration)
            return Response.json({ error: { code: 'FORBIDDEN' } }, { status: 403 });
          data = { submitted: true };
        } else if (path.endsWith('/auth/password/login')) {
          if (!(globalThis as unknown as { reviewed?: boolean }).reviewed)
            return Response.json({ error: { code: 'REGISTRATION_PENDING' } }, { status: 403 });
          data = { token: 'u'.repeat(64), installationId, expiresAt };
        } else if (path.endsWith('/domain-registration') && !user)
          return Response.json({ error: { code: 'LOGIN_REQUIRED' } }, { status: 403 });
        else if (path.endsWith('/domain-registration'))
          data = {
            domainCreated: '2020-01-01T00:00:00.000Z',
            domainExpires: '',
            registrar: 'Test Registry',
          };
        else return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
        return Response.json({ data, requestId: crypto.randomUUID() });
      }) as typeof fetch;
      return chrome.storage.local.set({ uiLocalePreference: 'zh-Hans' });
    });
    const panel = await context.newPage();
    const id = new URL(worker.url()).host;
    await panel.goto('chrome-extension://' + id + '/sidepanel.html');
    await panel.evaluate(async () => {
      const [realTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = { ...realTab, active: true, url: 'https://fixture.example/products/mug' };
      chrome.tabs.query = (() => Promise.resolve([tab])) as unknown as typeof chrome.tabs.query;
      chrome.tabs.get = (() => Promise.resolve(tab)) as unknown as typeof chrome.tabs.get;
      await chrome.storage.local.set({
        'websiteOverview:v6:https://fixture.example': {
          savedAt: Date.now(),
          data: {
            url: 'https://fixture.example',
            pageUrl: tab.url,
            host: 'fixture.example',
            name: 'Fixture shop',
            shopify: true,
            domain: 'fixture.myshopify.com',
            theme: '',
            currency: 'USD',
            country: 'US',
            language: 'en',
          },
        },
      });
    });
    await panel.getByRole('button', { name: '网站概览', exact: true }).click();
    const popupPromise = context.waitForEvent('page');
    await panel.getByRole('button', { name: '登录后查看域名信息', exact: true }).click();
    const popup = await popupPromise;
    await popup.waitForURL('http://127.0.0.1:3107/extension-auth?**');
    await popup.setViewportSize({ width: 500, height: 760 });
    await expect(popup.getByRole('heading', { name: '开始你的选品研究' })).toHaveCount(0);
    await expect(popup.locator('textarea')).toHaveCount(0);
    await expect(popup.getByText(/审核|尚未验证归属/)).toHaveCount(0);
    await popup.screenshot({ path: 'artifacts/registration-application.png', fullPage: true });
    await popup.getByLabel('邮箱', { exact: true }).fill('test@example.com');
    await popup.getByLabel('密码', { exact: true }).fill('Synthetic-pass-42');
    await popup.getByLabel('确认密码', { exact: true }).fill('Synthetic-pass-42');
    await popup.getByRole('checkbox').check();
    await popup.getByRole('button', { name: '注册', exact: true }).last().click();
    await expect(popup.locator('p[role=alert]')).toHaveText(
      '服务器拒绝了此次请求，请联系管理员检查插件访问配置。',
    );
    await worker.evaluate(() => {
      (globalThis as unknown as { allowRegistration: boolean }).allowRegistration = true;
    });
    await popup.getByRole('button', { name: '注册', exact: true }).last().click();
    await expect(popup.getByRole('heading', { name: '申请已提交' })).toBeVisible();
    await popup.screenshot({ path: 'artifacts/registration-pending.png', fullPage: true });
    await popup.getByRole('button', { name: '前往登录', exact: true }).click();
    await popup.getByLabel('密码', { exact: true }).fill('Synthetic-pass-42');
    await popup.getByRole('button', { name: '登录', exact: true }).last().click();
    await expect(popup.locator('p[role=alert]')).toHaveText('账号正在审核中，请审核通过后再登录。');
    expect(await popup.evaluate(() => JSON.stringify(sessionStorage))).not.toContain(
      'Synthetic-pass-42',
    );
    await popup.screenshot({ path: 'artifacts/registration-login.png', fullPage: true });
    await worker.evaluate(() => {
      (globalThis as unknown as { reviewed: boolean }).reviewed = true;
    });
    const closed = popup.waitForEvent('close');
    await popup.getByRole('button', { name: '登录', exact: true }).last().click();
    await expect(popup.getByRole('heading', { name: '登录成功', exact: true })).toBeVisible();
    await closed;
    await expect(panel.getByText('Test Registry', { exact: true })).toBeVisible();
    await panel.locator('.account-link').click();
    await expect(panel.getByText('test@example.com', { exact: true })).toBeVisible();
  } finally {
    await context.close();
    if (!profile.startsWith(path.resolve('artifacts') + path.sep))
      throw Error('UNSAFE_TEST_PROFILE');
    await rm(profile, { recursive: true, force: true });
  }
});
