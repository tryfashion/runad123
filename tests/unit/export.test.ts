import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  AuthService,
  ProductService,
  RiskService,
  RiskWorker,
  ExportService,
  prepareProduct,
  createMemoryMailer,
  secretToken,
  disabledAiConfig,
} from '../../packages/server-core/src/index.js';
import {
  normalizeShopify,
  productCsv,
  verifyExportHash,
} from '../../packages/product-core/src/index.js';
import { consentVersion } from '../../packages/contracts/src/auth.js';
import { MemoryAuthStore } from '../support/memory-auth-store.js';
function source() {
  return normalizeShopify(readFileSync('tests/fixtures/shopify-ajax-multi.json', 'utf8'), {
    pageUrl: 'https://fixture.example/products/runad123-probe-trail-mug',
    currency: 'USD',
    method: 'ajax_js',
  });
}
// Independent RFC4180 reader for cell-level assertions, including multiline quoted cells.
export function parseCsv(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '\uFEFF' && i === 0) continue;
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && c === ',') {
      row.push(cell);
      cell = '';
    } else if (!quoted && c === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  return rows;
}
async function setup(
  assessment: 'no_obvious_signals' | 'needs_review' | 'signals_found' = 'no_obvious_signals',
) {
  let now = new Date('2026-09-12T12:00:00Z');
  const store = new MemoryAuthStore(),
    auth = new AuthService(store, createMemoryMailer('test'), secretToken(), () => now),
    products = new ProductService(auth),
    risk = new RiskService(auth),
    exports = new ExportService(auth);
  store.rows.settings.push({
    key: 'ai_risk',
    valueJson: {
      ...disabledAiConfig,
      enabled: true,
      model: 'fixture',
      pricingVersion: 'fixture',
      inputPerMillion: '1',
      outputPerMillion: '2',
      dailyBudget: '100',
    },
    version: 1,
    updatedBy: null,
    createdAt: now,
    updatedAt: now,
  });
  const credential = await auth.install(
    { consentVersion, consentAccepted: true, extensionVersion: '0.0.1' },
    randomUUID(),
  );
  const draft = (
    await products.capture(
      { product: source(), draftContext: { targetCountry: 'US', language: 'preserve' } },
      randomUUID(),
      credential.token,
    )
  ).preparedRevision;
  const r = await risk.start(
    draft.draftId,
    { revision: 1, reportLocale: 'en' },
    randomUUID(),
    credential.token,
  );
  await new RiskWorker(
    risk,
    {
      run: async () => ({
        output: {
          assessment,
          severity:
            assessment === 'needs_review'
              ? 'unknown'
              : assessment === 'signals_found'
                ? 'medium'
                : 'low',
          findings:
            assessment === 'signals_found'
              ? [
                  {
                    id: 'f1',
                    field: 'title',
                    quote: 'Trail',
                    category: 'other_text_risk',
                    reason: 'Fixture',
                    suggestion: 'Review',
                  },
                ]
              : [],
          summary: 'Fixture',
        },
        retryable: false,
        usage: { input: 10, output: 10 },
      }),
    },
    'fixture',
  ).tick();
  const input = {
    revision: 1,
    riskRequestId: r.aiRequestId,
    acknowledgedFindingIds: [] as string[],
    csvMappingVersion: 1,
  };
  const permit = (patch: Record<string, unknown> = {}, key = randomUUID()) =>
    exports.permit(draft.draftId, { ...input, ...patch }, key, credential.token);
  return {
    auth,
    store,
    products,
    risk,
    exports,
    credential,
    draft,
    r,
    input,
    permit,
    advance: (ms: number) => {
      now = new Date(+now + ms);
    },
  };
}
it('maps variants/images/options and safely round-trips comma, quotes, unicode and newlines', async () => {
  const p = source();
  p.title = '=SUM(1,2) 中文 🐾';
  p.descriptionHtml = '<p>Quote " and comma,</p>\n<p>第二行</p>';
  p.options.push({ name: 'Size', position: 2, values: ['Large', 'Small'] });
  p.variants.forEach((v, i) => v.optionValues.push(i ? 'Small' : 'Large'));
  const d = prepareProduct(p, { targetCountry: 'US', language: 'preserve' }, randomUUID(), 1),
    rows = parseCsv(productCsv(d)),
    h = rows.shift()!;
  expect(rows).toHaveLength(3);
  const cell = (i: number, name: string) => rows[i]![h.indexOf(name)];
  expect(cell(0, 'Title')).toBe(d.preparedProduct.title);
  expect(cell(0, 'Title')).toMatch(/^'/);
  expect(cell(0, 'Description')).toBe(d.preparedProduct.descriptionHtml);
  expect(cell(1, 'Option2 value')).toBe('Small');
  expect(cell(0, 'Price')).toBe('24.99');
  expect(cell(2, 'Price')).toBe('');
  expect(rows.every((r) => r[h.indexOf('Status')] === 'draft')).toBe(true);
  expect(rows.every((r) => r[h.indexOf('Published on online store')] === 'false')).toBe(true);
  expect(h).not.toContain('Inventory quantity');
  expect(h).not.toContain('Barcodes');
  expect(await verifyExportHash(d)).toBe(true);
  expect(
    await verifyExportHash({ ...d, preparedProduct: { ...d.preparedProduct, title: 'tampered' } }),
  ).toBe(false);
});
it.each(['JPY', 'KRW', 'USD'])(
  'preserves %s decimal strings and empty SKU without conversion',
  (currency) => {
    const p = source();
    p.currency = currency;
    p.variants = p.variants.slice(0, 1);
    p.observedVariantCount = 1;
    p.expectedVariantCount = 1;
    p.variants[0]!.price = '2500';
    delete p.variants[0]!.sku;
    const rows = parseCsv(
      productCsv(prepareProduct(p, { targetCountry: 'US', language: 'preserve' }, randomUUID(), 1)),
    );
    expect(rows[1]![rows[0]!.indexOf('Price')]).toBe('2500');
    expect(rows[1]![rows[0]!.indexOf('SKU')]).toBe('');
  },
);
it.each(['needs_review', 'signals_found'] as const)(
  'requires exact acknowledgement for %s',
  async (assessment) => {
    const f = await setup(assessment);
    await expect(f.permit()).rejects.toMatchObject({ code: 'RISK_ACK_REQUIRED' });
    const ack = assessment === 'needs_review' ? ['assessment:needs_review'] : ['f1'];
    const p = await f.permit({ acknowledgedFindingIds: ack });
    expect(p.preparedRevision).toEqual(f.draft);
    expect(f.store.rows.permits[0]?.acknowledgedFindingsJson).toEqual(ack);
    expect(f.store.rows.events.filter((e) => e.eventType === 'export_authorized')).toHaveLength(1);
  },
);
it('deduplicates permits, rejects expired keys, wrong mapping and stale text', async () => {
  const f = await setup(),
    key = randomUUID(),
    p = await f.permit({}, key);
  expect((await f.permit({}, key)).permitId).toBe(p.permitId);
  await expect(f.permit({ csvMappingVersion: 2 })).rejects.toMatchObject({
    code: 'CLIENT_UPGRADE_REQUIRED',
  });
  f.advance(600001);
  await expect(f.permit({}, key)).rejects.toMatchObject({ code: 'EXPORT_PERMIT_EXPIRED' });
  await f.products.patch(
    f.draft.draftId,
    { expectedRevision: 1, title: 'Changed' },
    f.credential.token,
  );
  await expect(f.permit({ revision: 2 })).rejects.toMatchObject({ code: 'RISK_CHECK_STALE' });
});
it('permits export-setting changes using an unchanged text check but a new export hash', async () => {
  const f = await setup(),
    old = await f.permit();
  await f.products.patch(
    f.draft.draftId,
    { expectedRevision: 1, exportSettings: { ...f.draft.exportSettings, preserveSku: false } },
    f.credential.token,
  );
  const next = await f.permit({ revision: 2 });
  expect(next.exportHash).not.toBe(old.exportHash);
  expect(next.preparedRevision.textHash).toBe(old.preparedRevision.textHash);
});
it('enforces gate, ownership, failed checks and client event identity/state/idempotency', async () => {
  const f = await setup(),
    p = await f.permit(),
    stranger = await f.auth.install(
      { consentVersion, consentAccepted: true, extensionVersion: '0.0.1' },
      randomUUID(),
    );
  const event = { type: 'download_completed', clientEventId: randomUUID() };
  await expect(f.exports.download(p.permitId, event, stranger.token)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  await f.exports.download(p.permitId, event, f.credential.token);
  await f.exports.download(p.permitId, event, f.credential.token);
  await f.exports.download(
    p.permitId,
    { ...event, clientEventId: randomUUID() },
    f.credential.token,
  );
  expect(f.store.rows.events.filter((e) => e.eventType === 'download_completed')).toHaveLength(1);
  await expect(
    f.exports.download(
      p.permitId,
      { type: 'download_failed', clientEventId: randomUUID() },
      f.credential.token,
    ),
  ).rejects.toMatchObject({ code: 'DOWNLOAD_STATE_CONFLICT' });
  f.store.rows.settings[0]!.valueJson = 'login_required';
  await expect(f.permit()).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' });
  f.store.rows.settings[0]!.valueJson = 'anonymous_allowed';
  f.store.rows.jobs[0]!.state = 'failed';
  await expect(f.permit()).rejects.toMatchObject({ code: 'RISK_CHECK_STALE' });
});

it('generates a stable source fingerprint handle on creation and preserves it across edits', () => {
  const p = source(),
    a = prepareProduct(p, { targetCountry: 'US', language: 'preserve' }, randomUUID(), 1);
  expect(a.exportSettings.handle).toMatch(/^[a-z0-9-]+-[a-f0-9]{10}$/);
  const b = prepareProduct(
    { ...p, title: 'Changed title' },
    { targetCountry: 'US', language: 'preserve' },
    a.draftId,
    2,
    a.exportSettings,
  );
  expect(b.exportSettings.handle).toBe(a.exportSettings.handle);
  const foreign = prepareProduct(
    {
      ...p,
      source: {
        ...p.source,
        storeHost: 'other.example',
        canonicalUrl: p.source.canonicalUrl.replace('fixture.example', 'other.example'),
        pageUrl: p.source.pageUrl.replace('fixture.example', 'other.example'),
      },
    },
    { targetCountry: 'US', language: 'preserve' },
    randomUUID(),
    1,
  );
  expect(foreign.exportSettings.handle).not.toBe(a.exportSettings.handle);
});
