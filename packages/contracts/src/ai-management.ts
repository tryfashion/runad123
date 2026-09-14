import { z } from 'zod';
const money = z
  .string()
  .max(21)
  .regex(/^\d{1,14}(\.\d{1,6})?$/);
export const aiProfileSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
  endpoint: z
    .url()
    .max(300)
    .refine((value) => {
      const u = new URL(value);
      return (
        u.protocol === 'https:' &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        (!u.port || u.port === '443')
      );
    }),
  path: z
    .string()
    .max(150)
    .regex(/^\/[a-zA-Z0-9_/-]+$/),
  model: z.string().trim().min(1).max(100),
  riskRules: z.string().max(12000),
  rewriteRules: z.string().max(12000),
  timeoutSeconds: z.number().int().min(5).max(120),
  maxAttempts: z.number().int().min(1).max(5),
  retryBaseSeconds: z.number().int().min(1).max(60),
  temperature: z.number().min(0).max(2),
  outputTokens: z.number().int().min(512).max(16000),
  inputTokenBudget: z.number().int().min(2000).max(1000000),
  contextTokens: z.number().int().min(4096).max(2000000),
  inputPerMillion: money,
  outputPerMillion: money,
  dailyBudget: money,
});
export const aiProfileSaveSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative(),
  profile: aiProfileSchema,
  apiKey: z.string().trim().min(1).max(2048).optional(),
  useForRisk: z.boolean(),
  useForRewrite: z.boolean(),
});
export const aiProfileDeleteSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative(),
  id: z.uuid(),
});
export const aiProfileViewSchema = aiProfileSchema.extend({
  hasKey: z.boolean(),
  updatedAt: z.iso.datetime(),
  useForRisk: z.boolean(),
  useForRewrite: z.boolean(),
});
export const aiManagementSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  items: z.array(aiProfileViewSchema),
});
export type AiProfile = z.infer<typeof aiProfileSchema>;
export type AiManagement = z.infer<typeof aiManagementSchema>;
