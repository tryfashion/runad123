import { chromium, test, expect } from '@playwright/test';
import { mkdir, mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

test('live Dailero product collects and downloads through the release drawer', async () => {
  test.skip(process.env.RUNAD_LIVE_COLLECTOR !== '1', 'Explicit live-store opt-in required');
  test.setTimeout(90000);
  await mkdir('artifacts', { recursive: true });
  const root = await mkdtemp(path.resolve('artifacts/collector-browser-'));
  const extension = path.join(root, 'extension');
  await cp(path.resolve('apps/extension/dist'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  // Grant only the live storefront at installation, so this test has no permission prompt.
  manifest.host_permissions.push('https://dailero.com/*');
  await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  const context = await chromium.launchPersistentContext(path.join(root, 'profile'), {
    channel: 'chromium',
    headless: true,
    acceptDownloads: true,
    downloadsPath: path.join(root, 'downloads'),
    args: [
      '--no-proxy-server',
      '--disable-extensions-except=' + extension,
      '--load-extension=' + extension,
    ],
  });
  try {
    console.log('LIVE_BROWSER_READY');
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    worker.on('console', (msg) => console.log('WORKER', msg.text()));
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ uiLocalePreference: 'en' });
      const execute = chrome.scripting.executeScript.bind(chrome.scripting);
      chrome.scripting.executeScript = (async (
        input: chrome.scripting.ScriptInjection<unknown[], unknown>,
      ) => {
        console.log('INJECT_START', input.func?.name, input.injectImmediately);
        const result = await execute(input);
        console.log('INJECT_END', input.func?.name);
        return result;
      }) as typeof chrome.scripting.executeScript;
      const originalDownload = chrome.downloads.download.bind(chrome.downloads);
      chrome.downloads.download = ((options: chrome.downloads.DownloadOptions) => {
        (globalThis as unknown as { requestedFilename: string }).requestedFilename =
          options.filename ?? '';
        return originalDownload(options);
      }) as typeof chrome.downloads.download;
      globalThis.fetch = (async () =>
        Response.json({ error: { code: 'SERVICE_NOT_READY' } }, { status: 503 })) as typeof fetch;
    });
    const page = await context.newPage();
    page.on('request', (req) => {
      if (/dailero.com\/(cart.js|products\/.+\.js)/.test(req.url()))
        console.log('PRODUCT_REQUEST', new URL(req.url()).pathname);
    });
    page.on('response', (res) => {
      if (/dailero.com\/(cart.js|products\/.+\.js)/.test(res.url()))
        console.log('PRODUCT_RESPONSE', new URL(res.url()).pathname, res.status());
    });
    async function drawer(url: string) {
      console.log('LIVE_NAVIGATE');
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      console.log('LIVE_PAGE_READY');
      await page.bringToFront();
      await page.evaluate((id) => {
        const iframe = document.createElement('iframe');
        iframe.src = 'chrome-extension://' + id + '/sidepanel.html';
        iframe.style.cssText =
          'position:fixed;right:0;top:0;width:490px;height:100vh;border:0;z-index:2147483647';
        document.body.append(iframe);
      }, id);
      return page.frameLocator('iframe[src^="chrome-extension://"]');
    }
    const frame = await drawer(
      'https://dailero.com/products/outdoor-hanging-water-fountain-for-garden-and-patio',
    );
    console.log('LIVE_DRAWER_READY');
    await frame
      .getByRole('button', { name: 'Current product', exact: false })
      .click({ timeout: 15000 });
    console.log('LIVE_COLLECT_CLICKED');
    await expect(frame.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0, {
      timeout: 20000,
    });
    console.log('LIVE_COLLECT_STATUS', await frame.locator('[role=status]').allTextContents());
    await expect(
      frame.getByLabel('Target sales country (two-letter code)', { exact: true }),
    ).toHaveCount(0);
    await expect(frame.getByLabel('Product language', { exact: true })).toHaveCount(0);
    await expect(frame.getByRole('button', { name: 'Create draft', exact: true })).toHaveCount(0);
    await expect(frame.locator('details')).toHaveCount(0);
    const download = () =>
      worker.evaluate(async () => {
        const [item] = await chrome.downloads.search({ limit: 1, orderBy: ['-startTime'] });
        return item ? { state: item.state, filename: item.filename, error: item.error } : null;
      });
    await expect.poll(async () => (await download())?.state).toBe('complete');
    expect(await worker.evaluate(async () => (await chrome.downloads.search({})).length)).toBe(1);
    const file = (await download())!;
    expect(file.error).toBeUndefined();
    const csv = await readFile(file.filename, 'utf8');
    expect(csv).toContain('Solar Powered Bird Bath Fountain');
    console.log('LIVE_PRODUCT_CSV_DOWNLOADED');
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ uiLocalePreference: 'zh-Hans' });
    });
    await expect(frame.getByRole('heading', { name: '产品', exact: true })).toBeVisible();
    await expect(frame.locator('.catalog-product')).toHaveCount(5);
    await expect
      .poll(
        () =>
          frame
            .locator('.catalog-image img')
            .first()
            .evaluate((image: HTMLImageElement) => image.naturalWidth),
        { timeout: 15000 },
      )
      .toBeGreaterThan(0);
    const clip = (await page.locator('iframe[src^="chrome-extension://"]').boundingBox())!;
    await page.screenshot({ path: 'artifacts/catalog-dailero-list.png', clip });
    await frame.getByRole('button', { name: '网格视图' }).click();
    await page.screenshot({ path: 'artifacts/catalog-dailero-grid.png', clip });
  } finally {
    await context.close();
    if (!root.startsWith(path.resolve('artifacts') + path.sep))
      throw Error('UNSAFE_TEST_DIRECTORY');
    await rm(root, { recursive: true, force: true });
  }
});
