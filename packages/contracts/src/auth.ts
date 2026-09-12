import { z } from 'zod';
import { accessModeSchema, uiLocaleSchema } from './index.js';

export const consentVersion = '2026-09-12';
export const installationInput = z.strictObject({
  extensionVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+(?:\.\d+)?$/)
    .max(32),
  consentVersion: z.literal(consentVersion),
  consentAccepted: z.literal(true),
});
export const emailStartInput = z.strictObject({
  email: z
    .string()
    .trim()
    .pipe(z.email().max(254))
    .transform((value) => value.toLowerCase()),
  clientKind: z.enum(['extension', 'web']),
  deliveryLocale: uiLocaleSchema,
});
export const emailVerifyInput = z.strictObject({
  challengeId: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
  linkInstallationHistory: z.boolean(),
});
export const settingsInput = z.strictObject({
  accessMode: accessModeSchema,
  expectedVersion: z.number().int().positive(),
});
export const publicUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: z.enum(['user', 'admin']),
});
export const credentialSchema = z.object({
  token: z.string().min(43).max(128),
  expiresAt: z.iso.datetime(),
  installationId: z.uuid(),
});
export const configSchema = z.object({
  accessMode: accessModeSchema,
  configVersion: z.number().int(),
  consentVersion: z.string(),
  supportedUiLocales: z.array(uiLocaleSchema),
  defaultUiLocale: uiLocaleSchema,
  protocolVersion: z.literal(1),
});
export const meSchema = z.object({
  user: publicUserSchema.nullable(),
  installationId: z.uuid().nullable(),
  loginRequired: z.boolean(),
  expiresAt: z.iso.datetime(),
  // Counters are introduced with M3; null is never presented as unlimited or zero.
  quota: z.null(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;
export type Me = z.infer<typeof meSchema>;
export type Credential = z.infer<typeof credentialSchema>;
export type PublicConfig = z.infer<typeof configSchema>;
