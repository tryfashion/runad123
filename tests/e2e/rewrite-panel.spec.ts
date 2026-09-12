import { chromium, test, expect } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeShopify } from '../../packages/product-core/src/index.js';
import { prepareProduct } from '../../packages/server-core/src/products.js';
test.use({ trace: 'off' });
test('rewrite defaults, recovery, locale independence, rejection and explicit selected-field acceptance (simulated API)', async () => {
  const extension = path.resolve('apps/extension/dist');
  await mkdir('artifacts', { recursive: true });
  const profile = await mkdtemp(path.resolve('artifacts/rewrite-panel-'));
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
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker')),
      id = new URL(worker.url()).host;
    const product = normalizeShopify(
      readFileSync('tests/fixtures/shopify-ajax-multi.json', 'utf8'),
      {
        pageUrl: 'https://fixture.example/products/runad123-probe-trail-mug',
        currency: 'USD',
        method: 'ajax_js',
      },
    );
    const first = prepareProduct(
        product,
        { targetCountry: 'US', language: 'preserve' },
        randomUUID(),
        1,
      ),
      second = prepareProduct(
        { ...product, title: 'Portable mug 750 ml' },
        { targetCountry: 'US', language: 'preserve' },
        first.draftId,
        2,
      );
    await worker.evaluate(
      async ({ first, second }) => {
        const original = globalThis.fetch;
        let current = first,
          requests: Record<string, unknown>[] = [];
        let status: Record<string, unknown> | null = null;
        const starts: Record<string, unknown>[] = [],
          patches: Record<string, unknown>[] = [],
          risks: Record<string, unknown>[] = [];
        (globalThis as typeof globalThis & { rewriteProbe?: () => unknown }).rewriteProbe = () => ({
          starts,
          patches,
          risks,
          current,
        });
        const response = (data: unknown) =>
          new Response(JSON.stringify({ data }), {
            headers: { 'Content-Type': 'application/json' },
          });
        globalThis.fetch = async (input, init) => {
          const url = String(input);
          if (url.endsWith('/risk-checks')) {
            risks.push(JSON.parse(String(init?.body)));
            return new Response(JSON.stringify({ error: { code: 'AI_UNAVAILABLE' } }), {
              status: 503,
            });
          }
          if (url.endsWith('/rewrites')) {
            const body = JSON.parse(String(init?.body));
            starts.push(body);
            const requestId = crypto.randomUUID();
            status = {
              kind: 'rewrite',
              aiRequestId: requestId,
              state: 'succeeded',
              progressStage: 'complete',
              cacheHit: false,
              reportLocale: body.reportLocale,
              revision: 1,
              current: true,
              error: null,
              retryAfterMs: 0,
              expiresAt: new Date(Date.now() + 86400000).toISOString(),
              result: {
                output: {
                  ...(body.rewriteTitle ? { title: 'Portable mug 750 ml' } : {}),
                  ...(body.rewriteDescription ? { descriptionHtml: '<p>New description</p>' } : {}),
                  changeSummary: ['Fixture suggestion'],
                  factualWarnings: [],
                },
                before: {
                  title: first.preparedProduct.title,
                  descriptionHtml: first.preparedProduct.descriptionHtml,
                },
                warnings: ['NUMERIC_FACTS_CHANGED'],
                model: 'fixture-model',
                checkedAt: new Date().toISOString(),
                textHash: first.textHash,
                reportLocale: body.reportLocale,
                promptVersion: 'rewrite-v1',
                schemaVersion: 1,
                scope: 'rewrite_suggestion',
                rewriteTitle: body.rewriteTitle,
                rewriteDescription: body.rewriteDescription,
              },
            };
            requests = [{ aiRequestId: requestId, kind: 'rewrite', state: 'active' }];
            return response({
              ...status,
              state: 'queued',
              progressStage: 'queued',
              result: null,
              retryAfterMs: 2000,
            });
          }
          if (url.includes('/ai-requests/')) {
            if (url.endsWith('/cancel')) {
              status = { ...status, state: 'cancelled', result: null };
              requests = requests.map((r) => ({ ...r, state: 'cancelled' }));
            }
            return response(status);
          }
          if (url.includes('/api/v1/drafts/')) {
            if (init?.method === 'PATCH') {
              const body = JSON.parse(String(init.body));
              patches.push(body);
              if (body.expectedRevision !== 1) return new Response('{}', { status: 409 });
              current = second;
              requests = [];
            }
            return response({ preparedRevision: current, aiRequests: requests });
          }
          return original(input, init);
        };
        await chrome.storage.local.set({
          uiLocalePreference: 'en',
          auth: {
            active: {
              token: 'a'.repeat(64),
              installationId: crypto.randomUUID(),
              expiresAt: new Date(Date.now() + 3600000).toISOString(),
            },
          },
          lastDraft: { id: first.draftId },
        });
      },
      { first, second },
    );
    const page = await context.newPage();
    await page.setViewportSize({ width: 400, height: 850 });
    await page.goto(`chrome-extension://${id}/sidepanel.html`);
    const panel = page.locator('.rewrite-panel');
    await expect(
      panel.getByRole('checkbox', { name: 'Rewrite title', exact: true }),
    ).not.toBeChecked();
    await expect(
      panel.getByRole('checkbox', { name: 'Rewrite description', exact: true }),
    ).not.toBeChecked();
    await expect(panel.getByRole('button', { name: 'Generate suggestions' })).toBeDisabled();
    await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('zh-Hans');
    await expect(panel.getByRole('button', { name: '生成改写建议' })).toBeDisabled();
    const probe = () =>
      worker.evaluate(() =>
        (globalThis as typeof globalThis & { rewriteProbe?: () => unknown }).rewriteProbe?.(),
      ) as Promise<{
        starts: Record<string, unknown>[];
        patches: Record<string, unknown>[];
        risks: Record<string, unknown>[];
      }>;
    expect((await probe()).starts).toHaveLength(0);
    expect((await probe()).risks).toHaveLength(0);
    await panel.getByRole('checkbox', { name: '改写标题', exact: true }).check();
    await panel.getByRole('button', { name: '生成改写建议' }).click();
    await page.getByRole('combobox', { name: '语言', exact: true }).selectOption('en');
    await expect(panel.getByText('Portable mug 750 ml', { exact: true })).toBeVisible();
    expect((await probe()).starts).toEqual([
      {
        revision: 1,
        reportLocale: 'zh-Hans',
        language: 'preserve',
        rewriteTitle: true,
        rewriteDescription: false,
      },
    ]);
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
      first.preparedProduct.title,
    );
    expect((await probe()).patches).toHaveLength(0);
    await page.reload();
    await expect(panel.getByText('Portable mug 750 ml', { exact: true })).toBeVisible();
    expect((await probe()).starts).toHaveLength(1);
    await page.getByLabel('Title', { exact: true }).fill('Unsaved manual edit');
    await expect(panel.getByRole('button', { name: 'Accept and save' })).toBeDisabled();
    await panel.getByRole('button', { name: 'Reject suggestions' }).click();
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Unsaved manual edit');
    expect((await probe()).patches).toHaveLength(0);
    await page.getByRole('button', { name: 'Reload saved draft', exact: true }).click();
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
      first.preparedProduct.title,
    );
    await panel.getByRole('checkbox', { name: 'Rewrite title', exact: true }).check();
    await panel.getByRole('button', { name: 'Generate suggestions' }).click();
    await expect(panel.getByText('Portable mug 750 ml', { exact: true })).toBeVisible();
    await expect(
      panel.getByText('Numbers changed. Verify dimensions, quantities and other numeric facts.', {
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({ path: 'artifacts/m4-rewrite-panel.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await panel.getByRole('button', { name: 'Accept and save' }).click();
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Portable mug 750 ml');
    await expect(page.getByText('Revision: 2', { exact: true })).toBeVisible();
    expect((await probe()).patches).toEqual([
      { expectedRevision: 1, title: 'Portable mug 750 ml' },
    ]);
    await expect.poll(async () => (await probe()).risks.length).toBe(1);
  } finally {
    await context.close();
    if (!profile.startsWith(path.resolve('artifacts') + path.sep))
      throw new Error('Unsafe profile path');
    await rm(profile, { recursive: true, force: true });
  }
});
