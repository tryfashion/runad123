import { z } from 'zod';
import { uiLocaleSchema } from './index.js';
export const riskStartSchema = z.strictObject({
  revision: z.number().int().positive(),
  reportLocale: uiLocaleSchema,
});
export const riskInputSchema = z.strictObject({
  title: z.string().min(1).max(512),
  descriptionText: z.string().max(80000),
  targetCountry: z.string().regex(/^[A-Z]{2}$/),
  language: z.enum(['preserve', 'en', 'zh-Hans', 'zh-Hant']),
  textHash: z.string().regex(/^[a-f0-9]{64}$/),
  reportLocale: uiLocaleSchema,
});
export type RiskInput = z.infer<typeof riskInputSchema>;
export const riskOutputSchema = z
  .strictObject({
    assessment: z.enum(['no_obvious_signals', 'signals_found', 'needs_review']),
    severity: z.enum(['low', 'medium', 'high', 'unknown']),
    findings: z
      .array(
        z.strictObject({
          id: z.string().regex(/^(?!assessment:)[a-zA-Z0-9_-]{1,64}$/),
          field: z.enum(['title', 'description']),
          quote: z.string().min(1).max(2000),
          category: z.enum([
            'brand_reference',
            'authorization_claim',
            'counterfeit_language',
            'protected_name_reference',
            'other_text_risk',
          ]),
          reason: z.string().min(1).max(2000),
          suggestion: z.string().min(1).max(2000),
        }),
      )
      .max(30),
    summary: z.string().min(1).max(4000),
  })
  .superRefine((v, ctx) => {
    if (
      new Set(v.findings.map((f) => f.id)).size !== v.findings.length ||
      (v.assessment === 'no_obvious_signals' &&
        (v.severity !== 'low' || v.findings.length !== 0)) ||
      (v.assessment === 'signals_found' && (!v.findings.length || v.severity === 'unknown')) ||
      (v.assessment === 'needs_review' && v.severity !== 'unknown')
    )
      ctx.addIssue({ code: 'custom', message: 'AI_INVALID_RESPONSE' });
  });
export const riskResultSchema = z.object({
  output: riskOutputSchema,
  model: z.string(),
  checkedAt: z.iso.datetime(),
  textHash: z.string(),
  reportLocale: uiLocaleSchema,
  promptVersion: z.string(),
  schemaVersion: z.literal(1),
  scope: z.literal('title_description_only'),
});
export const riskStatusSchema = z.object({
  aiRequestId: z.uuid(),
  state: z.enum([
    'queued',
    'running',
    'retry_wait',
    'succeeded',
    'failed',
    'cancelled',
    'blocked_auth',
  ]),
  progressStage: z.enum(['queued', 'provider', 'retry', 'complete', 'blocked']),
  cacheHit: z.boolean(),
  reportLocale: uiLocaleSchema,
  revision: z.number().int(),
  current: z.boolean(),
  result: riskResultSchema.nullable(),
  error: z.string().nullable(),
  retryAfterMs: z.number().int(),
  expiresAt: z.iso.datetime().nullable(),
});
export type RiskStatus = z.infer<typeof riskStatusSchema>;
export type RiskOutput = z.infer<typeof riskOutputSchema>;
export function validateRiskOutput(raw: unknown, input: RiskInput) {
  const result = riskOutputSchema.parse(raw);
  if (
    result.findings.some(
      (f) => !(f.field === 'title' ? input.title : input.descriptionText).includes(f.quote),
    )
  )
    throw new Error('AI_INVALID_RESPONSE');
  return result;
}
