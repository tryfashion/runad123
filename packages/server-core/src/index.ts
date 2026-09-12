import { z } from 'zod';

const mysqlUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === 'mysql:' && url.pathname.length > 1;
  });
const environment = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MYSQL_URL: z.preprocess((value) => (value === '' ? undefined : value), mysqlUrl.optional()),
  WORKER_HEARTBEAT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
});

export function readEnvironment(input: Record<string, string | undefined>) {
  const result = environment.safeParse(input);
  if (!result.success) {
    // Do not serialize Zod errors: they may include credential-bearing inputs.
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`ENV_INVALID: ${fields.join(', ')}`);
  }
  return result.data;
}

export function logEvent(event: string, fields: Record<string, string | number | boolean> = {}) {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), event, ...fields })}\n`);
}

export * from './auth.js';
export * from './mail.js';
export * from './security.js';

export * from './http.js';
export * from './runtime.js';

export * from './products.js';

export * from './risk-service.js';
export * from './risk-worker.js';
export * from './deepseek.js';

export * from './worker-runtime.js';

export * from './exports.js';

export * from './admin.js';

export * from './maintenance.js';
