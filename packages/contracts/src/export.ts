import { z } from 'zod';
import { preparedRevisionSchema } from './product.js';
export const permitInputSchema = z.strictObject({
  revision: z.number().int().positive(),
  riskRequestId: z.uuid(),
  acknowledgedFindingIds: z.array(z.string().min(1).max(100)).max(100),
  csvMappingVersion: z.number().int(),
});
export const permitSchema = z.object({
  permitId: z.uuid(),
  expiresAt: z.iso.datetime(),
  reportUntil: z.iso.datetime(),
  exportHash: z.string().regex(/^[a-f0-9]{64}$/),
  preparedRevision: preparedRevisionSchema,
});
export type ExportPermit = z.infer<typeof permitSchema>;
export const downloadEventSchema = z.strictObject({
  clientEventId: z.uuid(),
  type: z.enum(['download_started', 'download_completed', 'download_failed']),
  downloadErrorCode: z
    .string()
    .regex(/^[A-Z_]{1,80}$/)
    .optional(),
});
