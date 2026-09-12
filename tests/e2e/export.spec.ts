import { chromium, test, expect } from '@playwright/test';
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeShopify } from '../../packages/product-core/src/index.js';
import { prepareProduct } from '../../packages/server-core/src/products.js';
test.use({ trace: 'off' });
test('real Chrome CSV download survives panel close, reports completion and releases Blob (simulated API)', async () => {
  const extension = path.resolve('apps/extension/dist');
  await mkdir('artifacts', { recursive: true });
  const profile = await mkdtemp(path.resolve('artifacts/export-browser-')),
    downloadPath = path.join(profile, 'downloads');
  await mkdir(downloadPath);
  await mkdir(path.join(profile, 'Default'));
  await writeFile(
    path.join(profile, 'Default', 'Preferences'),
    JSON.stringify({
      download: {
        default_directory: downloadPath,
        prompt_for_download: false,
        directory_upgrade: true,
      },
    }),
  );
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    acceptDownloads: true,
    downloadsPath: downloadPath,
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
      ),
      draft = prepareProduct(
        product,
        { targetCountry: 'US', language: 'preserve' },
        randomUUID(),
        1,
      );
    await worker.evaluate(async (draft) => {
      const original = globalThis.fetch,
        requestId = crypto.randomUUID(),
        permitId = crypto.randomUUID();
      let eventCalls = 0;
      const response = (data: unknown) => Response.json({ data });
      (globalThis as typeof globalThis & { exportProbe?: () => number }).exportProbe = () =>
        eventCalls;
      globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url.endsWith('/export-permits'))
          return response({
            permitId,
            expiresAt: new Date(Date.now() + 600000).toISOString(),
            reportUntil: new Date(Date.now() + 86400000).toISOString(),
            exportHash: draft.exportHash,
            preparedRevision: draft,
          });
        if (url.includes('/export-permits/') && url.endsWith('/events')) {
          eventCalls++;
          return response({ recorded: true });
        }
        if (url.includes('/ai-requests/'))
          return response({
            aiRequestId: requestId,
            state: 'succeeded',
            progressStage: 'complete',
            cacheHit: false,
            reportLocale: 'en',
            revision: 1,
            current: true,
            result: {
              output: {
                assessment: 'needs_review',
                severity: 'unknown',
                findings: [],
                summary: 'Fixture manual review',
              },
              model: 'fixture',
              checkedAt: new Date().toISOString(),
              textHash: draft.textHash,
              reportLocale: 'en',
              promptVersion: 'risk-v1',
              schemaVersion: 1,
              scope: 'title_description_only',
            },
            error: null,
            retryAfterMs: 0,
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
          });
        if (url.includes('/drafts/'))
          return response({
            preparedRevision: draft,
            aiRequests: [{ aiRequestId: requestId, kind: 'risk_check', state: 'active' }],
          });
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
        lastDraft: { id: draft.draftId },
      });
    }, draft);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath });
    await page.goto(`chrome-extension://${id}/sidepanel.html`);
    const button = page.getByRole('button', { name: 'Download CSV', exact: true });
    await expect(button).toBeDisabled();
    await page
      .getByRole('checkbox', { name: 'I understand the check could not determine the risk' })
      .check();
    await expect(button).toBeEnabled();
    await button.click();
    await page.close();
    await expect
      .poll(() =>
        worker.evaluate(
          async () =>
            (
              (await chrome.storage.local.get('downloads')).downloads as
                { state: string; reported: boolean }[] | undefined
            )?.[0]?.state,
        ),
      )
      .toBe('complete');
    await expect
      .poll(() =>
        worker.evaluate(
          async () =>
            (
              (await chrome.storage.local.get('downloads')).downloads as
                { reported: boolean }[] | undefined
            )?.[0]?.reported,
        ),
      )
      .toBe(true);
    const items = await worker.evaluate(() => chrome.downloads.search({ limit: 1 }));
    expect(items[0]?.state).toBe('complete');
    const file = items[0]!.filename;
    expect(path.resolve(file).startsWith(path.resolve(downloadPath) + path.sep)).toBe(true);
    const csv = await readFile(file, 'utf8');
    expect(csv).toContain('"Status"');
    expect(csv).toContain('"draft"');
    expect(csv).toContain('24.99');
    await expect
      .poll(() =>
        worker.evaluate(
          async () =>
            (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length,
        ),
      )
      .toBe(0);
    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${id}/sidepanel.html`);
    await expect(
      reopened.getByText(/Download completed — Shopify import still required/),
    ).toBeVisible();
    expect(
      await worker.evaluate(() =>
        (globalThis as typeof globalThis & { exportProbe?: () => number }).exportProbe?.(),
      ),
    ).toBe(2);
  } finally {
    await context.close();
    if (!profile.startsWith(path.resolve('artifacts') + path.sep))
      throw new Error('Unsafe profile path');
    await rm(profile, { recursive: true, force: true });
  }
});
