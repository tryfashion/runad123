import { chromium, test, expect } from '@playwright/test';
import { mkdir, mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

test('copy tool enables native events and restores page restrictions', async () => {
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
    await page.route('https://fixture.example/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<style>p {user-select:none !important}</style><p id="sample">Copy this text</p><input id="input"><script>
    for (const name of ['copy','cut','paste','contextmenu','selectstart','dragstart']) document.addEventListener(name, event => event.preventDefault());
    </script>`,
      }),
    );
    await page.goto('https://fixture.example/');
    await page.bringToFront();
    await page.evaluate((id) => {
      const iframe = document.createElement('iframe');
      iframe.src = 'chrome-extension://' + id + '/sidepanel.html';
      iframe.style.cssText =
        'position:fixed;right:0;top:0;width:470px;height:100vh;z-index:2147483647';
      document.body.append(iframe);
    }, id);
    const frame = page.frameLocator('iframe');
    await frame.getByRole('button', { name: 'Tools', exact: true }).click();
    const toggle = frame.getByRole('switch', { name: 'Enable copying' });
    const allowed = () =>
      page.evaluate(() =>
        ['copy', 'cut', 'paste', 'contextmenu', 'selectstart', 'dragstart'].map((name) =>
          document
            .querySelector('#sample')!
            .dispatchEvent(new Event(name, { bubbles: true, cancelable: true })),
        ),
      );
    expect(await allowed()).toEqual(Array(6).fill(false));
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(await allowed()).toEqual(Array(6).fill(true));
    expect(await page.locator('#sample').evaluate((el) => getComputedStyle(el).userSelect)).toBe(
      'text',
    );
    await frame.getByRole('button', { name: 'Product', exact: true }).click();
    await frame.getByRole('button', { name: 'Tools', exact: true }).click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await page.screenshot({ path: 'artifacts/copy-tool.png' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(await allowed()).toEqual(Array(6).fill(false));
    expect(await page.locator('#sample').evaluate((el) => getComputedStyle(el).userSelect)).toBe(
      'none',
    );
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await page.reload();
    expect(await allowed()).toEqual(Array(6).fill(false));
  } finally {
    await context.close();
    if (!root.startsWith(path.resolve('artifacts') + path.sep))
      throw Error('UNSAFE_TEST_DIRECTORY');
    await rm(root, { recursive: true, force: true });
  }
});
