import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  normalizeShopify,
  canonicalProductUrl,
  decimalPrice,
  parseShopify,
} from '../../packages/product-core/src/index.js';
import { captureInput, sourceProductSchema } from '../../packages/contracts/src/product.js';
import {
  ProductService,
  AuthService,
  createMemoryMailer,
  secretToken,
  prepareProduct,
} from '../../packages/server-core/src/index.js';
import { MemoryAuthStore } from '../support/memory-auth-store.js';
import { consentVersion } from '../../packages/contracts/src/auth.js';
const raw = readFileSync('tests/fixtures/shopify-ajax-multi.json', 'utf8');
const context = {
  pageUrl:
    'https://fixture.example/products/runad123-probe-trail-mug?variant=9007199254740995&utm_source=secret',
  currency: 'USD',
  method: 'ajax_js' as const,
};
const product = () => normalizeShopify(raw, context);
async function setup() {
  const store = new MemoryAuthStore(),
    auth = new AuthService(store, createMemoryMailer('test'), secretToken()),
    service = new ProductService(auth);
  const credential = await auth.install(
    { extensionVersion: '0.0.1', consentVersion, consentAccepted: true },
    'ip',
  );
  return { store, auth, service, credential };
}
describe('product normalization and sanitization', () => {
  it('keeps large IDs exact and money decimal strings', () => {
    const p = product();
    expect(p.source.shopifyProductId).toBe('9007199254740993');
    expect(p.variants[0]!.price).toBe('24.99');
    expect(p.variants[0]!.imageId).toBe(p.images[0]!.id);
    expect(p.source.pageUrl).not.toContain('secret');
  });
  it('canonicalizes locale and collection URLs', () => {
    expect(
      canonicalProductUrl('https://fixture.example/fr/collections/new/products/hat?secret=yes')
        .canonicalUrl,
    ).toBe('https://fixture.example/fr/products/hat');
  });
  it('uses hundredths for JPY and KRW instead of ISO minor digit scaling', () => {
    for (const currency of ['JPY', 'KRW'])
      expect(
        normalizeShopify(raw.replace('2499', '100000'), { ...context, currency }).variants[0]!
          .price,
      ).toBe('1000.00');
  });
  it('requires independent fallback currency evidence and does not divide decimal prices', () => {
    const p = JSON.parse(JSON.stringify(parseShopify(raw)));
    p.variants[0].price = '24.99';
    p.variants[1].price = '25.99';
    expect(() =>
      normalizeShopify(JSON.stringify({ product: p }), { ...context, method: 'product_json' }),
    ).toThrow('CURRENCY_UNVERIFIED');
    const value = normalizeShopify(JSON.stringify({ product: p }), {
      ...context,
      method: 'product_json',
      verifiedFallbackCurrency: 'USD',
    });
    expect(value.variants[0]!.price).toBe('24.99');
    expect(decimalPrice('001.200')).toBe('1.200');
  });
  it('rejects duplicate variants, missing image references and inconsistent counts', () => {
    const p = product();
    expect(
      sourceProductSchema.safeParse({ ...p, variants: [p.variants[0], p.variants[0]] }).success,
    ).toBe(false);
    expect(
      sourceProductSchema.safeParse({
        ...p,
        variants: [{ ...p.variants[0], imageId: 'missing' }, p.variants[1]],
      }).success,
    ).toBe(false);
    expect(sourceProductSchema.safeParse({ ...p, expectedVariantCount: 100 }).success).toBe(false);
  });
  it('refuses a capped response, subscriptions and missing target country', () => {
    const p = JSON.parse(raw);
    p.variants = Array.from({ length: 250 }, (_, i) => ({ ...p.variants[0], id: String(i + 1) }));
    expect(() => normalizeShopify(JSON.stringify(p), context)).toThrow('PRODUCT_INCOMPLETE');
    p.requires_selling_plan = true;
    expect(() => normalizeShopify(JSON.stringify(p), context)).toThrow('UNSUPPORTED_PRODUCT');
    expect(
      captureInput.safeParse({ product: product(), draftContext: { language: 'preserve' } })
        .success,
    ).toBe(false);
  });
  it('removes executable HTML, extracts decoded visible text, and keeps formula handling in preparation', () => {
    const p = product();
    p.title = '=SUM(A1)';
    p.descriptionHtml =
      '<p onclick="alert(1)">A &amp; B</p><script>secret()</script><img src="javascript:alert(1)"><svg onload="alert(1)"></svg>';
    const result = prepareProduct(
      p,
      { targetCountry: 'US', language: 'preserve' },
      randomUUID(),
      1,
    );
    expect(result.preparedProduct.title).toBe("'=SUM(A1)");
    expect(result.descriptionText).toContain('A & B');
    expect(result.preparedProduct.descriptionHtml).not.toMatch(
      /onclick|javascript|script|svg|secret/,
    );
    expect(result.warnings).toContain('CONTENT_SANITIZED');
  });
  it('text changes invalidate text hash; export-only changes do not', () => {
    const p = product(),
      id = randomUUID(),
      base = prepareProduct(p, { targetCountry: 'US', language: 'preserve' }, id, 1);
    const changed = prepareProduct(
      { ...p, title: 'Another title' },
      { targetCountry: 'US', language: 'preserve' },
      id,
      2,
    );
    expect(changed.textHash).not.toBe(base.textHash);
    const settings = prepareProduct(p, { targetCountry: 'US', language: 'preserve' }, id, 2, {
      ...base.exportSettings,
      preserveSku: false,
    });
    expect(settings.textHash).toBe(base.textHash);
    expect(settings.exportHash).not.toBe(base.exportHash);
  });
  it('does not truncate descriptions over the text limit', () => {
    expect(() =>
      prepareProduct(
        { ...product(), descriptionHtml: '中'.repeat(20001) },
        { targetCountry: 'US', language: 'preserve' },
        randomUUID(),
        1,
      ),
    ).toThrow('TEXT_TOO_LONG');
  });
});
describe('draft services — transaction model', () => {
  it('deduplicates network retries while counting distinct collection actions', async () => {
    const f = await setup(),
      key = randomUUID(),
      input = { product: product(), draftContext: { targetCountry: 'US', language: 'preserve' } };
    const [a, b] = await Promise.all([
      f.service.capture(input, key, f.credential.token),
      f.service.capture(input, key, f.credential.token),
    ]);
    expect(a.captureId).toBe(b.captureId);
    await f.service.capture(input, randomUUID(), f.credential.token);
    expect(f.store.rows.captures).toHaveLength(2);
    expect(f.store.rows.events).toHaveLength(2);
    expect(f.store.rows.snapshots).toHaveLength(1);
  });
  it('rejects reuse of an idempotency key with a different payload', async () => {
    const f = await setup(),
      key = randomUUID(),
      input = { product: product(), draftContext: { targetCountry: 'US', language: 'preserve' } };
    await f.service.capture(input, key, f.credential.token);
    await expect(
      f.service.capture(
        { ...input, product: { ...input.product, title: 'Different' } },
        key,
        f.credential.token,
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
  it('protects ownership, immutable revisions, and concurrent editing', async () => {
    const f = await setup(),
      a = await f.service.capture(
        { product: product(), draftContext: { targetCountry: 'US', language: 'preserve' } },
        randomUUID(),
        f.credential.token,
      ),
      id = a.preparedRevision.draftId;
    const other = await f.auth.install(
      { extensionVersion: '0.0.1', consentVersion, consentAccepted: true },
      'ip',
    );
    await expect(f.service.get(id, other.token)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const results = await Promise.allSettled([
      f.service.patch(id, { expectedRevision: 1, title: 'One' }, f.credential.token),
      f.service.patch(id, { expectedRevision: 1, title: 'Two' }, f.credential.token),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(f.store.rows.revisions).toHaveLength(2);
    expect(
      (f.store.rows.revisions[0]!.preparedProductJson as { preparedProduct: { title: string } })
        .preparedProduct.title,
    ).toBe(product().title);
    f.store.rows.settings[0]!.valueJson = 'login_required';
    await expect(
      f.service.patch(id, { expectedRevision: 2, title: 'Three' }, f.credential.token),
    ).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' });
    expect((await f.service.get(id, f.credential.token)).preparedRevision.revision).toBe(2);
  });
  it('no-op patches do not increment revision and purged revisions cannot be read', async () => {
    const f = await setup(),
      a = await f.service.capture(
        { product: product(), draftContext: { targetCountry: 'US', language: 'preserve' } },
        randomUUID(),
        f.credential.token,
      ),
      id = a.preparedRevision.draftId;
    expect(
      (await f.service.patch(id, { expectedRevision: 1 }, f.credential.token)).preparedRevision
        .revision,
    ).toBe(1);
    f.store.rows.revisions[0]!.payloadPurgedAt = new Date();
    await expect(f.service.get(id, f.credential.token)).rejects.toMatchObject({
      code: 'RESOURCE_EXPIRED',
    });
  });
});
