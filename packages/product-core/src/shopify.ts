import { parse } from 'lossless-json';
import { sourceProductSchema, type SourceProduct } from '@runad123/contracts/product';
import { decimalFromHundredths } from './index.js';
export function canonicalProductUrl(input: string) {
  const u = new URL(input);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password)
    throw new Error('UNSUPPORTED_PRODUCT');
  const match = /^(\/[^/]+)?(?:\/collections\/[^/]+)?\/products\/([^/]+)\/?$/.exec(u.pathname);
  if (!match?.[2]) throw new Error('UNSUPPORTED_PRODUCT');
  const handle = decodeURIComponent(match[2]),
    prefix = match[1] ?? '';
  const canonicalUrl = u.origin + prefix + '/products/' + encodeURIComponent(handle);
  return {
    canonicalUrl,
    handle,
    storeHost: u.hostname,
    root: u.origin + prefix + '/',
    selectedVariantId: /^\d{1,32}$/.test(u.searchParams.get('variant') ?? '')
      ? u.searchParams.get('variant')!
      : undefined,
  };
}
export function parseShopify(raw: string): Record<string, unknown> {
  if (raw.length > 2 * 1024 * 1024) throw new Error('BODY_TOO_LARGE');
  const parsed = parse(raw, undefined, (value) => value);
  return record(parsed);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('PRODUCT_INCOMPLETE');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('PRODUCT_INCOMPLETE');
  return value;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('PRODUCT_INCOMPLETE');
  return value;
}
export function decimalPrice(raw: string) {
  if (!/^\d+(\.\d{1,6})?$/.test(raw)) throw new Error('INVALID_MONEY');
  const [a, b = ''] = raw.split('.');
  return BigInt(a!).toString() + (b ? '.' + b : '');
}
export function normalizeShopify(
  raw: string,
  context: {
    pageUrl: string;
    currency: string;
    method: 'ajax_js' | 'product_json';
    capturedAt?: string;
    verifiedFallbackCurrency?: string;
  },
): SourceProduct {
  const url = canonicalProductUrl(context.pageUrl),
    data = parseShopify(raw),
    p = context.method === 'product_json' ? record(data.product) : data;
  if (p.requires_selling_plan === true || p.gift_card === true || p.requires_components === true)
    throw new Error('UNSUPPORTED_PRODUCT');
  if (text(p.handle) !== url.handle) throw new Error('SOURCE_CHANGED');
  if (context.method === 'product_json' && context.verifiedFallbackCurrency !== context.currency)
    throw new Error('CURRENCY_UNVERIFIED');
  const rawVariants = array(p.variants),
    rawOptions = array(p.options);
  if (rawVariants.length >= 250) throw new Error('PRODUCT_INCOMPLETE');
  const price = (value: unknown) =>
    context.method === 'ajax_js' ? decimalFromHundredths(text(value)) : decimalPrice(text(value));
  const imageUrl = (value: unknown) => new URL(text(value), url.canonicalUrl).href;
  const images = array(p.images).map((value, i) => {
    const image = typeof value === 'string' ? { src: value } : record(value);
    return {
      id: typeof image.id === 'string' ? image.id : String(i + 1),
      url: imageUrl(image.src),
      alt: typeof image.alt === 'string' ? image.alt : '',
      position: i + 1,
    };
  });
  const variants = rawVariants.map((value) => {
    const v = record(value),
      image = v.featured_image ? record(v.featured_image) : null;
    const imageId =
      typeof v.image_id === 'string'
        ? images.find((i) => i.id === v.image_id)?.id
        : image?.src
          ? images.find((i) => i.url === imageUrl(image.src))?.id
          : undefined;
    if ((typeof v.image_id === 'string' || image?.src) && !imageId)
      throw new Error('PRODUCT_INCOMPLETE');
    return {
      sourceVariantId: text(v.id),
      optionValues: Array.isArray(v.options)
        ? v.options.map(text)
        : rawOptions.map((_, i) => text(v['option' + (i + 1)])),
      price: price(v.price),
      ...(v.compare_at_price != null ? { compareAtPrice: price(v.compare_at_price) } : {}),
      ...(typeof v.sku === 'string' ? { sku: v.sku } : {}),
      ...(typeof v.barcode === 'string' ? { barcode: v.barcode } : {}),
      ...(imageId ? { imageId } : {}),
      ...(typeof v.available === 'boolean' ? { available: v.available } : {}),
      ...(typeof v.requires_shipping === 'boolean'
        ? { requiresShipping: v.requires_shipping }
        : {}),
      ...(typeof v.taxable === 'boolean' ? { taxable: v.taxable } : {}),
      ...(typeof v.weight === 'string' && context.method === 'ajax_js'
        ? { weightGrams: decimalPrice(v.weight) }
        : {}),
    };
  });
  const options = rawOptions.map((value, i) => ({
    name: typeof value === 'string' ? value : text(record(value).name),
    position: i + 1,
    values: [...new Set(variants.map((v) => v.optionValues[i]!))],
  }));
  const warnings: string[] = [];
  if (Array.isArray(p.selling_plan_groups) && p.selling_plan_groups.length)
    warnings.push('ONE_TIME_PURCHASE_ONLY');
  if (Array.isArray(p.media) && p.media.some((m) => record(m).media_type !== 'image'))
    warnings.push('MEDIA_NOT_MIGRATED');
  return sourceProductSchema.parse({
    schemaVersion: 1,
    source: {
      pageUrl: url.canonicalUrl,
      ...(url.selectedVariantId ? { selectedVariantId: url.selectedVariantId } : {}),
      canonicalUrl: url.canonicalUrl,
      storeHost: url.storeHost,
      shopifyProductId: text(p.id),
      handle: url.handle,
      method: context.method,
      capturedAt: context.capturedAt ?? new Date().toISOString(),
    },
    title: text(p.title),
    descriptionHtml: text(p.description ?? p.body_html ?? ''),
    vendor: typeof p.vendor === 'string' ? p.vendor : '',
    productType: typeof (p.type ?? p.product_type) === 'string' ? (p.type ?? p.product_type) : '',
    tags: Array.isArray(p.tags)
      ? p.tags.map(text)
      : typeof p.tags === 'string'
        ? p.tags
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    currency: context.currency,
    marketCountry: null,
    currencyEvidence: context.method === 'ajax_js' ? 'cart_js' : 'verified_source',
    options,
    variants,
    images,
    completeness: 'complete',
    warnings,
    observedVariantCount: variants.length,
  });
}
export function stableJson(value: unknown): string {
  function canonical(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === 'object')
      return Object.fromEntries(
        Object.entries(input)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => [k, canonical(v)]),
      );
    return input;
  }
  return JSON.stringify(canonical(value));
}
