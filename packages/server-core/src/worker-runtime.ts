import { ConfiguredAiProvider } from './ai-management.js';
import { MaintenanceService } from './maintenance.js';
import { createAuthStore } from '@runad123/db';
import { randomUUID } from 'node:crypto';
import { AuthService } from './auth.js';
import { disabledMailer } from './mail.js';
import { RiskService } from './risk-service.js';
import { RiskWorker } from './risk-worker.js';
import { DeepSeekProvider } from './deepseek.js';
export function createWorkerRuntime(env: NodeJS.ProcessEnv) {
  if (!env.MYSQL_URL || !env.AUTH_SECRET) return null;
  const store = createAuthStore(env.MYSQL_URL),
    auth = new AuthService(store, disabledMailer, env.AUTH_SECRET),
    worker =
      env.LOCAL_PREVIEW_ENABLED === 'true'
        ? null
        : new RiskWorker(
            new RiskService(auth),
            new ConfiguredAiProvider(
              auth,
              env.DEEPSEEK_API_KEY
                ? new DeepSeekProvider(
                    env.DEEPSEEK_API_KEY,
                    env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
                  )
                : undefined,
            ),
            'worker-' + randomUUID(),
          );
  const maintenance = new MaintenanceService(auth);
  let lastMaintenance = 0;
  return {
    aiProcessing: !!worker,
    tick: async () => {
      if (Date.now() - lastMaintenance >= 30000) {
        try {
          await maintenance.tick();
        } catch {
          process.stdout.write(
            JSON.stringify({ event: 'maintenance.failed', code: 'MAINTENANCE_CYCLE_FAILED' }) +
              '\n',
          );
        }
        lastMaintenance = Date.now();
      }
      return worker ? worker.tick() : false;
    },
    close: () => store.close(),
  };
}
