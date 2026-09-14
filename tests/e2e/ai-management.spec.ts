import { test, expect } from '@playwright/test';
import { createAuthHandler } from '../../packages/server-core/src/http.js';
import { AiManagementService } from '../../packages/server-core/src/ai-management.js';
import { MemoryAuthStore } from '../support/memory-auth-store.js';
import { m6Fixture } from '../support/m6-fixture.js';
test('administrator saves and edits AI configuration without exposing stored key', async ({
  page,
  context,
}) => {
  const store = new MemoryAuthStore(),
    f = await m6Fixture(store),
    origin = 'http://127.0.0.1:3107';
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
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/admin?lang=zh-Hans');
  await page.getByRole('menuitem', { name: /系统管理/ }).click();
  await page.getByRole('menuitem', { name: /AI 配置管理/ }).click();
  await expect(page.getByLabel('配置名称', { exact: true })).toHaveValue('DeepSeek');
  await page.getByLabel('配置名称', { exact: true }).fill('商品文本助手');
  await page.getByLabel('API Key', { exact: true }).fill('synthetic-browser-key');
  await page.getByLabel('用于标题 / 描述风险检查', { exact: true }).check();
  await page.getByLabel('用于标题 / 描述改写', { exact: true }).check();
  await page.getByLabel('启用配置', { exact: true }).click();
  await page.getByText('高级设置', { exact: true }).click();
  await page.getByLabel('每百万输入 Token 价格（USD）', { exact: true }).fill('1');
  await page.getByLabel('每百万输出 Token 价格（USD）', { exact: true }).fill('2');
  await page.getByLabel('每日总预算（USD）', { exact: true }).fill('20');
  await page.getByLabel('改写规则', { exact: true }).fill('保留商品尺寸、材质和数量，不夸大功效。');
  await page.getByRole('button', { name: /保存配置/ }).click();
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: '检查配置', exact: true })).toBeEnabled();
  const manager = new AiManagementService(f.auth);
  let saved = await manager.list(f.root.credential.token);
  expect(saved.items).toHaveLength(1);
  expect(saved.items[0]?.useForRisk).toBe(true);
  expect(JSON.stringify(saved)).not.toContain('synthetic-browser-key');
  await page.getByLabel('模型', { exact: true }).fill('custom-model');
  await expect(page.getByRole('button', { name: '检查配置', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /保存配置/ }).click();
  await expect(page.getByRole('button', { name: '检查配置', exact: true })).toBeEnabled();
  saved = await manager.list(f.root.credential.token);
  expect(saved.items[0]?.model).toBe('custom-model');
  expect(saved.items[0]?.hasKey).toBe(true);
  await page.screenshot({ path: 'artifacts/ai-configuration.png', fullPage: true });
  await page.getByRole('button', { name: '删除配置', exact: true }).click();
  await page.getByRole('button', { name: '删除配置', exact: true }).last().click();
  await expect(page.getByText('尚未配置 AI API')).toBeVisible();
  saved = await manager.list(f.root.credential.token);
  expect(saved.items).toHaveLength(0);
  await page.getByRole('button', { name: '新增配置', exact: true }).click();
  await expect(page.getByLabel('配置名称', { exact: true })).toHaveValue('DeepSeek');
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
});
