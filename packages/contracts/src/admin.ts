import { z } from 'zod';
import { uiLocaleSchema } from './index.js';
export const tutorialInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(1000),
  url: z.url().max(2048),
  contentLocale: uiLocaleSchema,
  category: z.enum(['getting-started', 'shopify', 'advertising']),
  placement: z.enum(['website', 'extension', 'both']),
  sortOrder: z.number().int().min(0).max(10000),
  enabled: z.boolean(),
});
export const tutorialSchema = tutorialInputSchema
  .extend({ id: z.uuid(), version: z.number().int().positive() })
  .strip();
export const tutorialQuerySchema = z.object({
  locale: uiLocaleSchema.default('en'),
  placement: z.enum(['website', 'extension']).default('website'),
  category: z.enum(['getting-started', 'shopify', 'advertising']).optional(),
  cursor: z.string().max(512).optional(),
});
export const limitsInputSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  dailyBudget: z.string().regex(/^\d{1,14}(\.\d{1,6})?$/),
  riskAnonymous: z.number().int().min(1).max(1000),
  riskAccount: z.number().int().min(1).max(10000),
  rewriteAnonymous: z.number().int().min(1).max(1000),
  rewriteAccount: z.number().int().min(1).max(10000),
  allowedTutorialHosts: z
    .array(z.string().regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/))
    .max(30),
});
export const trendQuerySchema = z.object({
  window: z.enum(['24h', '7d', '30d']).default('7d'),
  metric: z.enum(['export', 'capture']).default('export'),
  cursor: z.string().max(512).optional(),
});
export const adminUserStatusInputSchema = z.strictObject({
  status: z.enum(['active', 'disabled']),
});
export const adminAccountInputSchema = z.strictObject({
  login: z
    .string()
    .trim()
    .min(3)
    .max(254)
    .transform((value) => value.toLowerCase()),
  email: z
    .string()
    .trim()
    .pipe(z.email().max(254))
    .transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(256),
});
export const adminPasswordResetInputSchema = z.strictObject({
  password: z.string().min(8).max(256),
});
export type Tutorial = z.infer<typeof tutorialSchema>;

export const tutorialListSchema = z.object({
  items: z.array(tutorialSchema),
  nextCursor: z.string().nullable(),
});
export const limitsResponseSchema = limitsInputSchema.strip();
export type Limits = z.infer<typeof limitsInputSchema>;
export type TutorialInput = z.infer<typeof tutorialInputSchema>;
export type AdminUserStatusInput = z.infer<typeof adminUserStatusInputSchema>;
export type AdminAccountInput = z.infer<typeof adminAccountInputSchema>;
export type AdminPasswordResetInput = z.infer<typeof adminPasswordResetInputSchema>;

export * from './theme-links.js';
