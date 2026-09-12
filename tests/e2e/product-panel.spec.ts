import { chromium, test, expect } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeShopify } from '../../packages/product-core/src/index.js';
import { prepareProduct } from '../../packages/server-core/src/products.js';
test.use({ trace: 'off' });
test('extension restores edits and risk result; language does not restart checking (simulated API)', async () => {
  const extension = path.resolve('apps/extension/dist');
  await mkdir('artifacts', { recursive: true });
  const profile = await mkdtemp(path.resolve('artifacts/product-panel-'));
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
    const id = new URL(worker.url()).host;
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
    );
    const second = prepareProduct(
      { ...product, title: 'Recovered local title' },
      { targetCountry: 'US', language: 'preserve' },
      first.draftId,
      2,
    );
    await worker.evaluate(
      async ({ first, second }) => {
        const original = globalThis.fetch;
        let current = first;
        const requestId = crypto.randomUUID();
        let riskCalls = 0;
        (globalThis as typeof globalThis & { riskCalls?: () => number }).riskCalls = () =>
          riskCalls;
        globalThis.fetch = async (input, init) => {
          if (String(input).includes('/risk-checks')) {
            riskCalls++;
            return new Response(JSON.stringify({ error: { code: 'AI_UNAVAILABLE' } }), {
              status: 503,
            });
          }
          if (String(input).includes('/ai-requests/'))
            return new Response(
              JSON.stringify({
                data: {
                  aiRequestId: requestId,
                  state: 'succeeded',
                  progressStage: 'complete',
                  cacheHit: false,
                  reportLocale: 'en',
                  revision: 1,
                  current: current.revision === 1,
                  result: {
                    output: {
                      assessment: 'needs_review',
                      severity: 'unknown',
                      findings: [],
                      summary: 'Fixture report requiring manual review.',
                    },
                    model: 'fixture-model',
                    checkedAt: new Date().toISOString(),
                    textHash: first.textHash,
                    reportLocale: 'en',
                    promptVersion: 'risk-v1',
                    schemaVersion: 1,
                    scope: 'title_description_only',
                  },
                  error: null,
                  retryAfterMs: 0,
                  expiresAt: new Date(Date.now() + 86400000).toISOString(),
                },
              }),
              { headers: { 'Content-Type': 'application/json' } },
            );
          if (String(input).includes('/api/v1/drafts/')) {
            if (init?.method === 'PATCH') {
              const body = JSON.parse(String(init.body));
              if (body.expectedRevision !== 1 || body.title !== 'Recovered local title')
                return new Response('{}', { status: 409 });
              current = second;
            }
            return new Response(
              JSON.stringify({
                data: {
                  preparedRevision: current,
                  aiRequests: [{ aiRequestId: requestId, state: 'active' }],
                },
              }),
              {
                headers: { 'Content-Type': 'application/json' },
              },
            );
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
          draftEdits: {
            draftId: first.draftId,
            revision: 1,
            edits: {
              title: second.preparedProduct.title,
              descriptionHtml: first.preparedProduct.descriptionHtml,
              targetCountry: first.targetCountry,
              language: first.language,
              exportSettings: first.exportSettings,
            },
          },
        });
      },
      { first, second },
    );
    const page = await context.newPage();
    await page.setViewportSize({ width: 400, height: 850 });
    await page.goto(`chrome-extension://${id}/sidepanel.html`);
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Recovered local title');
    await expect(
      page.getByText('Local edits restored. Save to create a new version.', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Fixture report requiring manual review.', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Check current text', exact: true }),
    ).toBeDisabled();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByText('Draft saved', { exact: true })).toBeVisible();
    await expect(page.getByText('Revision: 2', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Recovered local title');
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    await expect(
      page.getByText('Fixture report requiring manual review.', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'This result is not valid for the current text or configuration. Check again.',
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('zh-Hans');
    await expect(
      page.getByText('Fixture report requiring manual review.', { exact: true }),
    ).toBeVisible();
    expect(
      await worker.evaluate(() =>
        (globalThis as typeof globalThis & { riskCalls?: () => number }).riskCalls?.(),
      ),
    ).toBe(0);
    await page.getByRole('combobox', { name: '语言', exact: true }).selectOption('en');
    await worker.evaluate(async () => {
      const stored = (await chrome.storage.local.get('auth')).auth as {
        active: Record<string, unknown>;
      };
      await chrome.storage.local.set({
        auth: { active: { ...stored.active, token: 'b'.repeat(64) } },
      });
    });
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Recovered local title');
    await expect(
      page.getByText('Fixture report requiring manual review.', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Check current text', exact: true }).click();
    await expect(
      page.getByText('The AI service is not configured or is unavailable.', { exact: true }),
    ).toBeVisible();
    await page.getByText('Sanitized preview', { exact: true }).click();
    await page.screenshot({ path: 'artifacts/m3-risk-panel.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await context.close();
    if (!profile.startsWith(path.resolve('artifacts') + path.sep))
      throw new Error('Unsafe profile path');
    await rm(profile, { recursive: true, force: true });
  }
});
