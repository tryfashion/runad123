import { createAuthStore } from '@runad123/db';
import { z } from 'zod';
import { AuthService } from './auth.js';
import { createAuthHandler } from './http.js';
import { createMemoryMailer, createSmtpMailer, disabledMailer } from './mail.js';

let handler: ((request: Request) => Promise<Response>) | undefined;
export function runtimeHandler(request: Request): Promise<Response> {
  try {
    if (!handler) {
      const env = process.env;
      if (!env.MYSQL_URL || !env.AUTH_SECRET || !env.WEB_ORIGIN)
        throw new Error('AUTH_CONFIG_REQUIRED');
      const origin = new URL(env.WEB_ORIGIN);
      if (
        origin.origin !== env.WEB_ORIGIN ||
        (env.NODE_ENV === 'production' && origin.protocol !== 'https:')
      )
        throw new Error('INVALID_WEB_ORIGIN');
      const ids = (env.CHROME_EXTENSION_IDS ?? '').split(',').filter(Boolean);
      if (ids.some((id) => !/^[a-p]{32}$/.test(id))) throw new Error('INVALID_EXTENSION_IDS');
      if (env.TRUSTED_CLIENT_IP_HEADER && !/^[a-z0-9-]{1,64}$/.test(env.TRUSTED_CLIENT_IP_HEADER))
        throw new Error('INVALID_PROXY_HEADER');
      const kind = env.MAIL_MODE ?? 'disabled';
      if (!['disabled', 'memory', 'smtp'].includes(kind)) throw new Error('INVALID_MAIL_MODE');
      const mailer =
        kind === 'memory'
          ? createMemoryMailer(env.NODE_ENV ?? 'development')
          : kind === 'smtp'
            ? createSmtpMailer({
                host: z.string().min(1).parse(env.SMTP_HOST),
                port: z.coerce
                  .number()
                  .int()
                  .min(1)
                  .max(65535)
                  .parse(env.SMTP_PORT ?? 587),
                user: z.string().min(1).parse(env.SMTP_USER),
                password: z.string().min(1).parse(env.SMTP_PASSWORD),
                from: z.email().parse(env.SMTP_FROM),
              })
            : disabledMailer;
      handler = createAuthHandler(
        new AuthService(createAuthStore(env.MYSQL_URL), mailer, env.AUTH_SECRET),
        {
          webOrigin: env.WEB_ORIGIN,
          extensionIds: ids,
          production: env.NODE_ENV === 'production',
          trustedIpHeader: env.TRUSTED_CLIENT_IP_HEADER,
        },
      );
    }
    return handler(request);
  } catch {
    return Promise.resolve(
      Response.json(
        {
          error: {
            code: 'SERVICE_NOT_READY',
            message: 'Service is not configured.',
            retryable: true,
          },
          requestId: crypto.randomUUID(),
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      ),
    );
  }
}
