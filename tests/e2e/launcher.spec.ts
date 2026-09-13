import { chromium, test, expect } from '@playwright/test';
import { mkdir, mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

test('launcher waits for DOM readiness and opens the drawer', async () => {
  await mkdir('artifacts', { recursive: true });
  const root = await mkdtemp(path.resolve('artifacts/collector-browser-'));
  const extension = path.join(root, 'extension');
  await cp(path.resolve('apps/extension/dist'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  // Grant only the synthetic storefront at installation, so this test has no permission prompt.
  manifest.host_permissions.push('https://fixture.example/*');
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
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ uiLocalePreference: 'en' });
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
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('https://fixture.example/**', async (route) => {
      if (route.request().url().endsWith('/slow.js')) {
        await gate;
        await route.fulfill({ contentType: 'text/javascript', body: '' });
        return;
      }
      await route.fulfill({
        contentType: 'text/html',
        body: '<html><head><script src="/slow.js"></script></head><body><h1>Loading shop</h1></body></html>',
      });
    });
    await page.goto('https://fixture.example/', { waitUntil: 'commit' });
    const popup = await context.newPage();
    await popup.clock.install();
    await page.bringToFront();
    await popup.goto('chrome-extension://' + id + '/launcher.html');
    await expect(popup.getByRole('heading', { name: 'Store is still loading…' })).toBeVisible();
    await expect(page.locator('#runad123-extension-drawer-root')).toHaveCount(0);
    await popup.screenshot({ path: 'artifacts/launcher-loading.png' });
    await popup.clock.fastForward(21000);
    await expect(
      popup.getByRole('heading', { name: 'This page is taking longer to load' }),
    ).toBeVisible();
    await popup.getByRole('button', { name: 'Retry', exact: true }).click();
    release();
    await popup.clock.resume();
    await expect(page.locator('#runad123-extension-drawer-root iframe')).toBeVisible();
    const drawer = page.frameLocator('#runad123-extension-drawer-root iframe');
    await expect(drawer.locator('.brand-icon')).toBeVisible();
    await expect
      .poll(() =>
        drawer.locator('.brand-icon').evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
    const language = (await drawer.locator('.language-picker').boundingBox())!;
    const account = (await drawer.locator('.account-link').boundingBox())!;
    const close = (await page
      .locator('#runad123-extension-drawer-root aside > button')
      .boundingBox())!;
    expect(
      Math.abs(language.y + language.height / 2 - account.y - account.height / 2),
    ).toBeLessThan(2);
    expect(account.x + account.width).toBeLessThan(close.x);
    await drawer.locator('.topbar').screenshot({ path: 'artifacts/header-r-icon.png' });
  } finally {
    await context.close();
    if (!root.startsWith(path.resolve('artifacts') + path.sep))
      throw Error('UNSAFE_TEST_DIRECTORY');
    await rm(root, { recursive: true, force: true });
  }
});
