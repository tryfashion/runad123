import { chromium, test, expect } from '@playwright/test';
import { mkdir, mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

test('release bundle collects through the webpage drawer and creates a CSV download', async () => {
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
      await chrome.storage.local.set({
        uiLocalePreference: 'en',
        lastDraft: { id: '11111111-1111-4111-8111-111111111111' },
        draftEdits: { obsolete: true },
      });
      const originalDownload = chrome.downloads.download.bind(chrome.downloads);
      chrome.downloads.download = ((options: chrome.downloads.DownloadOptions) => {
        (globalThis as unknown as { requestedFilename: string }).requestedFilename =
          options.filename ?? '';
        return originalDownload(options);
      }) as typeof chrome.downloads.download;
      globalThis.fetch = (async () =>
        Response.json({ error: { code: 'SERVICE_NOT_READY' } }, { status: 503 })) as typeof fetch;
    });
    await context.addInitScript(() => {
      if (
        location.protocol !== 'chrome-extension:' ||
        !location.pathname.endsWith('/sidepanel.html')
      )
        return;
      const state = globalThis as typeof globalThis & { oldProductPageSeen?: boolean };
      state.oldProductPageSeen = false;
      new MutationObserver(() => {
        if (document.querySelector('.product-empty')) state.oldProductPageSeen = true;
      }).observe(document, { childList: true, subtree: true });
    });
    const raw = await readFile('tests/fixtures/shopify-ajax-multi.json', 'utf8');
    const page = await context.newPage();
    const catalog = Array.from({ length: 21 }, (_, i) => ({
      handle: i === 0 ? 'runad123-probe-trail-mug' : 'item-' + i,
      title: i === 0 ? 'Trail mug, "Forest" edition' : 'Product ' + i,
      vendor: i === 1 ? 'Acme' : 'Forest',
      product_type: i === 2 ? 'Kitchen' : 'Outdoor',
      created_at: '2026-08-' + String(31 - i).padStart(2, '0') + 'T00:00:00Z',
      variants: [{ price: String(i + 10) + '.00' }],
      images: [],
    }));
    let holdCart = true,
      cartStarted = false,
      releaseCart!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseCart = resolve;
    });
    let releaseListings!: () => void;
    const listingGate = new Promise<void>((resolve) => {
      releaseListings = resolve;
    });
    await page.route('https://fixture.example/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/products.json') || url.pathname.endsWith('/collections.json'))
        await listingGate;
      if (url.pathname === '/plain')
        return route.fulfill({ contentType: 'text/html', body: '<h1>Ordinary website</h1>' });
      if (url.pathname.endsWith('/cart.js')) {
        if (holdCart) {
          cartStarted = true;
          await gate;
        }
        return route.fulfill({ json: { currency: 'USD' } });
      }
      if (url.pathname.endsWith('/collections.json'))
        return route.fulfill({ json: { collections: [{ handle: 'mugs', title: 'Mugs' }] } });
      if (url.pathname.endsWith('/products.json')) {
        const items = url.pathname.includes('/collections/mugs') ? catalog.slice(0, 1) : catalog;
        const start = (Number(url.searchParams.get('page') ?? 1) - 1) * 5;
        return route.fulfill({ json: { products: items.slice(start, start + 5) } });
      }
      if (url.pathname.endsWith('.js')) {
        const handle = decodeURIComponent(url.pathname.split('/').pop()!.slice(0, -3));
        return route.fulfill({
          contentType: 'application/json',
          body: raw.replaceAll('runad123-probe-trail-mug', handle),
        });
      }
      return route.fulfill({
        contentType: 'text/html',
        body: '<script type="application/json" src="https://cdn.shopify.com/fixture"></script><h1>Fixture</h1>',
      });
    });
    await page.goto('https://fixture.example/products/runad123-probe-trail-mug');
    await page.bringToFront();
    await page.evaluate((id) => {
      const frame = document.createElement('iframe');
      frame.src = 'chrome-extension://' + id + '/sidepanel.html';
      frame.style.cssText =
        'position:fixed;right:0;top:0;width:470px;height:100vh;z-index:2147483647';
      document.body.append(frame);
    }, id);
    const frame = page.frameLocator('iframe');
    await expect(frame.getByRole('button', { name: 'All products', exact: false })).toBeVisible();
    await expect(
      frame.getByRole('button', { name: 'Current product', exact: false }),
    ).toBeEnabled();
    await expect(
      frame.getByRole('heading', { name: 'Export by collection', exact: true }),
    ).toBeVisible();
    await expect(frame.locator('.catalog-product')).toHaveCount(0);
    await expect(frame.getByRole('status')).toHaveText('Reading products…');
    releaseListings();
    await expect(frame.locator('.catalog-product')).toHaveCount(5);
    expect(
      await frame
        .locator('body')
        .evaluate(
          () =>
            (globalThis as typeof globalThis & { oldProductPageSeen?: boolean }).oldProductPageSeen,
        ),
    ).toBe(false);
    await expect(frame.getByLabel('Sort order')).toHaveValue('newest');
    await expect(frame.getByText(/bestseller/i)).toHaveCount(0);
    await frame.getByRole('button', { name: 'Current product', exact: false }).click();
    await expect.poll(() => cartStarted).toBe(true);
    await frame.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(
      frame.getByRole('button', { name: 'Current product', exact: false }),
    ).toBeEnabled();
    expect(await worker.evaluate(async () => (await chrome.downloads.search({})).length)).toBe(0);
    holdCart = false;
    releaseCart();
    await frame.getByRole('button', { name: 'Current product', exact: false }).click();
    const count = () =>
      worker.evaluate(async () => (await chrome.downloads.search({ state: 'complete' })).length);
    await expect.poll(count).toBe(1);
    const first = await worker.evaluate(async () => (await chrome.downloads.search({}))[0]!);
    const csv = await readFile(first.filename, 'utf8');
    expect(csv).toContain('PROBE-GREEN');
    expect(csv).toContain('PROBE-SAND');
    expect(
      await worker.evaluate(
        () => (globalThis as unknown as { requestedFilename: string }).requestedFilename,
      ),
    ).toBe('runad123/product-Trail mug, _Forest_ edition.csv');
    await frame.getByRole('searchbox').fill('Acme');
    await expect(frame.locator('.catalog-product')).toHaveCount(1);
    await frame.getByRole('searchbox').fill('Kitchen');
    await expect(frame.locator('.catalog-product')).toHaveCount(1);
    await frame.getByRole('searchbox').fill('');
    await frame.getByLabel('Sort order').selectOption('high');
    await expect(frame.locator('.catalog-product h3').first()).toHaveText('Product 4');
    await frame.getByRole('button', { name: 'Grid view' }).click();
    await expect(frame.locator('.catalog-grid')).toBeVisible();
    await page.screenshot({ path: 'artifacts/catalog-grid.png' });
    await frame.getByRole('button', { name: 'List view' }).click();
    await frame.getByRole('button', { name: 'Load more', exact: true }).click();
    await expect(frame.locator('.catalog-product')).toHaveCount(10);
    await frame.getByRole('button', { name: 'Load more', exact: true }).click();
    await expect(frame.locator('.catalog-product')).toHaveCount(15);
    await frame.getByLabel('All collections', { exact: true }).selectOption('mugs');
    await expect(frame.locator('.catalog-product')).toHaveCount(1);
    await frame.getByLabel('Export by collection', { exact: true }).selectOption('mugs');
    await frame.getByRole('button', { name: 'Export collection', exact: false }).click();
    await expect.poll(count).toBe(2);
    await frame.getByRole('button', { name: 'All products', exact: false }).click();
    await expect.poll(count).toBe(3);
    const last = await worker.evaluate(
      async () => (await chrome.downloads.search({ orderBy: ['-startTime'] }))[0]!,
    );
    expect(await readFile(last.filename, 'utf8')).toContain('item-20');
    await page.screenshot({ path: 'artifacts/catalog-list.png' });
    await page.goto('https://fixture.example/plain');
    await page.evaluate((id) => {
      const iframe = document.createElement('iframe');
      iframe.src = 'chrome-extension://' + id + '/sidepanel.html';
      iframe.style.cssText = 'position:fixed;right:0;top:0;width:470px;height:100vh';
      document.body.append(iframe);
    }, id);
    await expect(frame.getByRole('heading', { name: 'Non-Shop store' })).toBeVisible();
    await expect(frame.locator('.catalog-product')).toHaveCount(0);
  } finally {
    await context.close();
    if (!root.startsWith(path.resolve('artifacts') + path.sep))
      throw Error('UNSAFE_TEST_DIRECTORY');
    await rm(root, { recursive: true, force: true });
  }
});
