// DEV-ONLY CSV probe. Never imported into extension/web production code.
import { parse } from 'lossless-json';
import { decimalFromHundredths, encodeCsvCell } from '../packages/product-core/src/index.js';

export const probeColumns = [
  'URL handle',
  'Title',
  'Description',
  'Status',
  'Published on online store',
  'Option1 name',
  'Option1 value',
  'Option2 name',
  'Option2 value',
  'Option3 name',
  'Option3 value',
  'SKU',
  'Price',
  'Product image URL',
  'Image position',
  'Variant image URL',
];
type Row = Record<string, string>;
type Probe = { productId: string; variantIds: string[]; rows: Row[]; csv: string };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('PROBE_INVALID_OBJECT');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('PROBE_STRING_REQUIRED');
  return value;
}
function safeText(value: string) {
  if (/^[\s]*[=+@-]/.test(value))
    throw new Error('PROBE_FORMULA_PREFIX: edit the test fixture explicitly');
  return value;
}
function imageUrl(value: unknown) {
  const url = new URL(text(value).replace(/^\/\//, 'https://'));
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('PROBE_INVALID_IMAGE_URL');
  return url.href;
}

export function buildAjaxProbe(raw: string): Probe {
  // Parse numbers as strings before JavaScript can round external IDs.
  const source = object(parse(raw, undefined, (number) => number));
  const productId = text(source.id);
  if (!/^\d+$/.test(productId)) throw new Error('PROBE_INVALID_PRODUCT_ID');
  const handle = text(source.handle);
  if (!/^[a-z0-9-]+$/.test(handle)) throw new Error('PROBE_INVALID_HANDLE');
  const title = safeText(text(source.title));
  const description = safeText(text(source.description));
  // This small probe intentionally accepts only plain text, not unsanitized HTML.
  if (/[<>]/.test(description)) throw new Error('PROBE_PLAIN_TEXT_ONLY');
  if (
    !Array.isArray(source.variants) ||
    source.variants.length < 1 ||
    source.variants.length >= 250
  )
    throw new Error('PROBE_INCOMPLETE_VARIANTS');
  if (!Array.isArray(source.options) || source.options.length < 1 || source.options.length > 3)
    throw new Error('PROBE_INVALID_OPTIONS');
  if (!Array.isArray(source.images)) throw new Error('PROBE_INVALID_IMAGES');
  const optionNames = source.options.map((option) => safeText(text(object(option).name)));
  const images = [...new Set(source.images.map(imageUrl))];
  const rows: Row[] = [];
  const variantIds: string[] = [];
  for (const [index, value] of source.variants.entries()) {
    const variant = object(value);
    const id = text(variant.id);
    if (!/^\d+$/.test(id) || variantIds.includes(id)) throw new Error('PROBE_INVALID_VARIANT_ID');
    variantIds.push(id);
    if (!Array.isArray(variant.options) || variant.options.length !== optionNames.length)
      throw new Error('PROBE_OPTION_MISMATCH');
    const row: Row = {
      'URL handle': handle,
      Title: index === 0 ? title : '',
      Description: index === 0 ? description : '',
      Status: index === 0 ? 'draft' : '',
      'Published on online store': index === 0 ? 'false' : '',
      SKU: variant.sku == null ? '' : safeText(text(variant.sku)),
      Price: decimalFromHundredths(text(variant.price)),
    };
    optionNames.forEach((name, position) => {
      row[`Option${position + 1} name`] = name;
      row[`Option${position + 1} value`] = safeText(text((variant.options as unknown[])[position]));
    });
    if (variant.featured_image)
      row['Variant image URL'] = imageUrl(object(variant.featured_image).src);
    rows.push(row);
  }
  images.forEach((url, index) => {
    const row = rows[index] ?? { 'URL handle': handle };
    row['Product image URL'] = url;
    row['Image position'] = String(index + 1);
    if (!rows[index]) rows.push(row);
  });
  const csv =
    [probeColumns, ...rows.map((row) => probeColumns.map((key) => row[key] ?? ''))]
      .map((row) => row.map(encodeCsvCell).join(','))
      .join('\n') + '\n';
  return { productId, variantIds, rows, csv };
}
