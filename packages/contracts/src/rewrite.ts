import { z } from 'zod';
import { riskInputSchema, riskStartSchema, riskStatusSchema } from './risk.js';
import { contentLanguageSchema, uiLocaleSchema } from './index.js';
export const rewriteStartSchema = riskStartSchema
  .extend({
    rewriteTitle: z.boolean(),
    rewriteDescription: z.boolean(),
    language: contentLanguageSchema,
  })
  .refine((v) => v.rewriteTitle || v.rewriteDescription, { message: 'REWRITE_FIELDS_REQUIRED' });
export const rewriteInputSchema = riskInputSchema
  .extend({
    descriptionHtml: z.string().max(200000),
    rewriteTitle: z.boolean(),
    rewriteDescription: z.boolean(),
  })
  .refine((v) => v.rewriteTitle || v.rewriteDescription);
export type RewriteInput = z.infer<typeof rewriteInputSchema>;
export const rewriteOutputSchema = z.strictObject({
  title: z.string().min(1).max(512).optional(),
  descriptionHtml: z.string().max(200000).optional(),
  changeSummary: z.array(z.string().min(1).max(2000)).max(20),
  factualWarnings: z.array(z.string().min(1).max(2000)).max(20),
});
export type RewriteOutput = z.infer<typeof rewriteOutputSchema>;
export function validateRewriteOutput(raw: unknown, input: RewriteInput) {
  const value = rewriteOutputSchema.parse(raw);
  if (
    input.rewriteTitle !== (value.title !== undefined) ||
    input.rewriteDescription !== (value.descriptionHtml !== undefined)
  )
    throw new Error('AI_INVALID_RESPONSE');
  return value;
}
export const rewriteResultSchema = z.object({
  output: rewriteOutputSchema,
  before: z.object({ title: z.string(), descriptionHtml: z.string() }),
  warnings: z.array(z.enum(['NUMERIC_FACTS_CHANGED', 'CONTENT_SANITIZED'])),
  model: z.string(),
  checkedAt: z.iso.datetime(),
  textHash: z.string(),
  reportLocale: uiLocaleSchema,
  promptVersion: z.literal('rewrite-v1'),
  schemaVersion: z.literal(1),
  scope: z.literal('rewrite_suggestion'),
  rewriteTitle: z.boolean(),
  rewriteDescription: z.boolean(),
});
export const rewriteStatusSchema = riskStatusSchema.extend({
  kind: z.literal('rewrite'),
  result: rewriteResultSchema.nullable(),
});
export type RewriteStatus = z.infer<typeof rewriteStatusSchema>;
export const aiInputSchema = z.union([rewriteInputSchema, riskInputSchema]);
