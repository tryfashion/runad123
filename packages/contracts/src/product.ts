import { z } from 'zod';
import { contentLanguageSchema } from './index.js';
export const externalId = z.string().regex(/^[0-9]{1,32}$/);
export const money = z.string().regex(/^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$/);
export const country = z.string().regex(/^[A-Z]{2}$/);
export const publicUrl = z
  .url()
  .max(2048)
  .refine((value) => {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password;
  });
const short = z.string().max(512);
export const sourceProductSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    source: z.strictObject({
      pageUrl: publicUrl,
      canonicalUrl: publicUrl,
      storeHost: z.string().max(253),
      shopifyProductId: externalId,
      handle: short.min(1),
      method: z.enum(['ajax_js', 'product_json']),
      capturedAt: z.iso.datetime(),
      selectedVariantId: externalId.optional(),
    }),
    title: short.min(1),
    descriptionHtml: z.string().max(200000),
    vendor: short,
    productType: short,
    tags: z.array(short).max(250),
    currency: z.string().regex(/^[A-Z]{3}$/),
    marketCountry: country.nullable(),
    currencyEvidence: z.enum(['cart_js', 'verified_source']),
    options: z
      .array(
        z.strictObject({
          name: short.min(1),
          position: z.number().int().min(1).max(3),
          values: z.array(short).min(1).max(250),
        }),
      )
      .min(1)
      .max(3),
    variants: z
      .array(
        z.strictObject({
          sourceVariantId: externalId,
          optionValues: z.array(short).min(1).max(3),
          sku: short.optional(),
          barcode: short.optional(),
          price: money,
          compareAtPrice: money.optional(),
          imageId: short.optional(),
          available: z.boolean().optional(),
          requiresShipping: z.boolean().optional(),
          taxable: z.boolean().optional(),
          weightGrams: money.optional(),
        }),
      )
      .min(1)
      .max(250),
    images: z
      .array(
        z.strictObject({
          id: short.min(1),
          url: publicUrl,
          alt: short,
          position: z.number().int().min(1).max(250),
        }),
      )
      .max(250),
    completeness: z.enum(['complete', 'partial', 'uncertain']),
    warnings: z.array(z.string().max(100)).max(30),
    observedVariantCount: z.number().int().min(1).max(250),
    expectedVariantCount: z.number().int().positive().optional(),
  })
  .superRefine((p, ctx) => {
    const fail = () => ctx.addIssue({ code: 'custom', message: 'PRODUCT_INCOMPLETE' });
    if (
      new Set(p.variants.map((v) => v.sourceVariantId)).size !== p.variants.length ||
      new Set(p.images.map((i) => i.id)).size !== p.images.length
    )
      fail();
    if (
      p.observedVariantCount !== p.variants.length ||
      (p.expectedVariantCount !== undefined && p.expectedVariantCount !== p.variants.length)
    )
      fail();
    if (
      p.variants.some(
        (v) =>
          v.optionValues.length !== p.options.length ||
          v.optionValues.some((val, i) => !p.options[i]?.values.includes(val)) ||
          (v.imageId && !p.images.some((image) => image.id === v.imageId)),
      )
    )
      fail();
    if (p.options.some((o, i) => o.position !== i + 1)) fail();
    if (p.completeness === 'complete' && p.variants.length >= 250) fail();
    const canonical = new URL(p.source.canonicalUrl),
      page = new URL(p.source.pageUrl);
    if (
      canonical.hostname !== p.source.storeHost ||
      page.hostname !== p.source.storeHost ||
      canonical.search ||
      canonical.hash ||
      !canonical.pathname.endsWith('/products/' + encodeURIComponent(p.source.handle))
    )
      fail();
  });
export const exportSettingsSchema = z.strictObject({
  status: z.literal('draft'),
  published: z.literal(false),
  handle: short.min(1),
  preserveSku: z.boolean(),
  vendor: z.enum(['preserve', 'clear']),
});
export const captureInput = z.strictObject({
  product: sourceProductSchema,
  draftContext: z.strictObject({
    targetCountry: country,
    language: contentLanguageSchema.default('preserve'),
  }),
});
export const draftPatchSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  title: short.min(1).optional(),
  descriptionHtml: z.string().max(200000).optional(),
  targetCountry: country.optional(),
  language: contentLanguageSchema.optional(),
  exportSettings: exportSettingsSchema.optional(),
});
export const preparedRevisionSchema = z.object({
  draftId: z.uuid(),
  revision: z.number().int().positive(),
  sourceSummary: sourceProductSchema.shape.source,
  preparedProduct: sourceProductSchema,
  descriptionText: z.string(),
  exportSettings: exportSettingsSchema,
  targetCountry: country,
  language: contentLanguageSchema,
  textHash: z.string().regex(/^[a-f0-9]{64}$/),
  exportHash: z.string().regex(/^[a-f0-9]{64}$/),
  normalizerVersion: z.literal(1),
  csvMappingVersion: z.literal(1),
  warnings: z.array(z.string()),
});
export type SourceProduct = z.infer<typeof sourceProductSchema>;
export type PreparedRevision = z.infer<typeof preparedRevisionSchema>;
export type DraftPatch = z.infer<typeof draftPatchSchema>;
