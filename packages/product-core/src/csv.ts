import { stableJson } from './shopify.js';
import { preparedRevisionSchema, type PreparedRevision } from '@runad123/contracts/product';
import { encodeCsvCell } from './index.js';
// Current Shopify headings, pinned against the official template in tests/fixtures.
export const csvHeaders = [
  'URL handle',
  'Title',
  'Description',
  'Vendor',
  'Type',
  'Tags',
  'Published on online store',
  'Status',
  'Option1 name',
  'Option1 value',
  'Option2 name',
  'Option2 value',
  'Option3 name',
  'Option3 value',
  'SKU',
  'Price',
  'Compare-at price',
  'Product image URL',
  'Image position',
  'Image alt text',
  'Variant image URL',
] as const;
export function productCsv(raw: PreparedRevision) {
  const revision = preparedRevisionSchema.parse(raw),
    p = revision.preparedProduct,
    s = revision.exportSettings;
  if (p.completeness !== 'complete') throw new Error('PRODUCT_INCOMPLETE');
  if (!/^[a-zA-Z0-9-]+$/.test(s.handle)) throw new Error('INVALID_HANDLE');
  const headers: string[] = [...csvHeaders];
  if (p.variants.some((v) => v.barcode !== undefined)) headers.push('Barcodes');
  if (p.variants.some((v) => v.weightGrams !== undefined && !/^\d+$/.test(v.weightGrams)))
    throw new Error('INVALID_WEIGHT');
  if (p.variants.every((v) => v.weightGrams !== undefined)) headers.push('Weight value (grams)');
  if (p.variants.every((v) => v.requiresShipping !== undefined)) headers.push('Requires shipping');
  if (p.variants.every((v) => v.taxable !== undefined)) headers.push('Charge tax');
  const images = [...p.images].sort((a, b) => a.position - b.position);
  const rows: Record<string, string>[] = [];
  for (let index = 0; index < Math.max(p.variants.length, images.length); index++) {
    const row: Record<string, string> = {
      'URL handle': s.handle,
      Status: 'draft',
      'Published on online store': 'false',
    };
    const v = p.variants[index],
      image = images[index];
    if (index === 0)
      Object.assign(row, {
        Title: p.title,
        Description: p.descriptionHtml,
        Vendor: s.vendor === 'preserve' ? p.vendor : '',
        Type: p.productType,
        Tags: p.tags.join(', '),
        'Published on online store': 'false',
        Status: 'draft',
      });
    if (v) {
      for (let option = 0; option < p.options.length; option++) {
        row[`Option${option + 1} name`] = p.options[option]!.name;
        row[`Option${option + 1} value`] = v.optionValues[option]!;
      }
      Object.assign(row, {
        SKU: s.preserveSku ? (v.sku ?? '') : '',
        Price: v.price,
        'Compare-at price': v.compareAtPrice ?? '',
        'Variant image URL': images.find((i) => i.id === v.imageId)?.url ?? '',
      });
      if (v.barcode !== undefined)
        row['Barcodes'] = v.barcode
          .replaceAll('\\', '\\\\')
          .replaceAll(';', '\\;')
          .replaceAll(':', '\\:');
      if (v.weightGrams !== undefined) row['Weight value (grams)'] = v.weightGrams;
      if (v.requiresShipping !== undefined) row['Requires shipping'] = String(v.requiresShipping);
      if (v.taxable !== undefined) row['Charge tax'] = String(v.taxable);
    }
    if (image)
      Object.assign(row, {
        'Product image URL': image.url,
        'Image position': String(index + 1),
        'Image alt text': image.alt,
      });
    rows.push(row);
  }
  return (
    '\uFEFF' +
    [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ''))]
      .map((r) => r.map(encodeCsvCell).join(','))
      .join('\r\n') +
    '\r\n'
  );
}
export async function verifyExportHash(revision: PreparedRevision) {
  const bytes = new TextEncoder().encode(
    stableJson({
      preparedProduct: revision.preparedProduct,
      exportSettings: revision.exportSettings,
      textHash: revision.textHash,
      csvMappingVersion: revision.csvMappingVersion,
    }),
  );
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return (
    [...new Uint8Array(hash)].map((v) => v.toString(16).padStart(2, '0')).join('') ===
    revision.exportHash
  );
}
