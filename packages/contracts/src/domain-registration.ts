import { z } from 'zod';

export const domainRegistrationQuerySchema = z.object({
  host: z
    .string()
    .trim()
    .toLowerCase()
    .max(253)
    .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/)
    .transform((host) => host.replace(/^www\./, '')),
});
export const domainRegistrationSchema = z.object({
  domainCreated: z.union([z.iso.datetime({ offset: true }), z.literal('')]),
  domainExpires: z.union([z.iso.datetime({ offset: true }), z.literal('')]),
  registrar: z.string().max(250),
});
export type DomainRegistration = z.infer<typeof domainRegistrationSchema>;
