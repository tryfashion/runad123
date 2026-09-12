import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { buildAjaxProbe } from './probe-core.js';

const fixture = await readFile(
  new URL('../tests/fixtures/shopify-ajax-multi.json', import.meta.url),
  'utf8',
);
const probe = buildAjaxProbe(fixture);
const directory = new URL('../artifacts/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('m0-synthetic-product.csv', directory), probe.csv, 'utf8');
console.log(
  JSON.stringify({
    stage: 'M0',
    fixture: 'synthetic',
    currencyAssumption: 'USD',
    productId: probe.productId,
    variants: probe.variantIds.length,
    rows: probe.rows.length,
    realShopifyImport: 'NOT_VERIFIED',
    images: 'example.com placeholders, not importable assets',
  }),
);
