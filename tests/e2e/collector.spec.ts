import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { collectPage } from '../../apps/extension/src/collect-page.js';
import { normalizeShopify } from '../../packages/product-core/src/index.js';
const raw = readFileSync('tests/fixtures/shopify-ajax-multi.json', 'utf8');
type CollectedProductPayload = {
  raw: string;
  pageUrl: string;
  currency: string;
  method: 'ajax_js' | 'product_json';
  verifiedFallbackCurrency?: string;
};
function collected(result: Awaited<ReturnType<typeof collectPage>>): CollectedProductPayload {
  const value = result as Partial<CollectedProductPayload> & { error?: string };
  expect(value.error).toBeUndefined();
  if (!value.raw || !value.pageUrl || !value.currency || !value.method)
    throw new Error('collector returned incomplete data');
  return {
    raw: value.raw,
    pageUrl: value.pageUrl,
    currency: value.currency,
    method: value.method,
    verifiedFallbackCurrency: value.verifiedFallbackCurrency,
  };
}
test('isolated collector extracts only product data and currency from fixture storefront', async ({
  page,
}) => {
  await page.route('https://fixture.example/**', (route) => {
    const url = route.request().url();
    return route.fulfill({
      contentType: url.endsWith('.js') ? 'application/json' : 'text/html',
      body: url.endsWith('cart.js')
        ? JSON.stringify({
            currency: 'USD',
            token: 'cart-private-marker',
            items: [{ private: 'ignore' }],
          })
        : url.endsWith('.js')
          ? raw
          : '<script type="application/json" src="https://cdn.shopify.com/fixture"></script><h1>Fixture</h1>',
    });
  });
  await page.goto(
    'https://fixture.example/fr/products/runad123-probe-trail-mug?variant=9007199254740995',
  );
  const result = collected(await page.evaluate(collectPage));
  expect(JSON.stringify(result)).not.toContain('cart-private-marker');
  const product = normalizeShopify(result.raw!, {
    pageUrl: result.pageUrl!,
    currency: result.currency!,
    method: result.method!,
  });
  expect(product.variants).toHaveLength(2);
  expect(product.source.shopifyProductId).toBe('9007199254740993');
});
test('collector detects currency changes and refuses unverified JSON fallback', async ({
  page,
}) => {
  let carts = 0,
    change = true;
  await page.route('https://fixture.example/**', (route) => {
    const url = route.request().url();
    if (url.endsWith('cart.js'))
      return route.fulfill({ json: { currency: change && ++carts > 1 ? 'EUR' : 'USD' } });
    if (url.endsWith('.js'))
      return change
        ? route.fulfill({ body: raw })
        : route.fulfill({ status: 404, body: 'missing' });
    if (url.endsWith('.json')) return route.fulfill({ json: { product: JSON.parse(raw) } });
    return route.fulfill({
      contentType: 'text/html',
      body: '<script type="application/json" src="https://cdn.shopify.com/fixture"></script>',
    });
  });
  await page.goto('https://fixture.example/products/runad123-probe-trail-mug');
  expect((await page.evaluate(collectPage)).error).toBe('CURRENCY_CHANGED');
  change = false;
  const result = collected(await page.evaluate(collectPage));
  expect(result.method).toBe('product_json');
  expect(() =>
    normalizeShopify(result.raw!, {
      pageUrl: result.pageUrl!,
      currency: result.currency!,
      method: result.method!,
      verifiedFallbackCurrency: result.verifiedFallbackCurrency,
    }),
  ).toThrow('CURRENCY_UNVERIFIED');
});
