import { z } from 'zod';
const email = z
  .string()
  .trim()
  .pipe(z.email().max(254))
  .transform((value) => value.toLowerCase());
export const memberRegistrationInput = z
  .strictObject({
    email,
    password: z.string().min(8).max(256),
    confirmPassword: z.string().min(8).max(256),
    purpose: z.string().trim().min(5).max(500),
    consentAccepted: z.literal(true),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'PASSWORD_CONFIRM_MISMATCH',
  });
export const memberLoginInput = z.strictObject({ email, password: z.string().min(1).max(256) });
export const memberReviewInput = z.strictObject({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(500).default(''),
});
export const memberListQuery = z.object({
  state: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  cursor: z.uuid().optional(),
});
export const memberListSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      email: z.string(),
      purpose: z.string(),
      state: z.enum(['pending', 'approved', 'rejected']),
      createdAt: z.iso.datetime(),
      reviewedAt: z.iso.datetime().nullable(),
      note: z.string(),
      emailVerified: z.literal(false),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type MemberList = z.infer<typeof memberListSchema>;
