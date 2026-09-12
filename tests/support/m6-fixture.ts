import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AuthStore } from '../../packages/db/src/index.js';
import {
  AuthService,
  AdminService,
  MaintenanceService,
  ProductService,
  RiskService,
  RiskWorker,
  ExportService,
  createMemoryMailer,
  secretToken,
  disabledAiConfig,
} from '../../packages/server-core/src/index.js';
import { normalizeShopify } from '../../packages/product-core/src/index.js';
import { consentVersion } from '../../packages/contracts/src/auth.js';
export async function m6Fixture(store: AuthStore) {
  let now = new Date('2026-09-12T12:00:00Z');
  const mailer = createMemoryMailer('test'),
    auth = new AuthService(store, mailer, secretToken(), () => now),
    admin = new AdminService(auth),
    maintenance = new MaintenanceService(auth),
    products = new ProductService(auth),
    risk = new RiskService(auth),
    exports = new ExportService(auth);
  await store.transaction(async (tx) => {
    for (const key of ['ai_risk', 'ai_rewrite', 'admin_limits']) {
      const prior = (await tx.find('settings', { key }))[0],
        valueJson =
          key === 'admin_limits'
            ? { allowedTutorialHosts: ['learn.example.com'] }
            : {
                ...disabledAiConfig,
                promptVersion: key === 'ai_rewrite' ? 'rewrite-v1' : 'risk-v1',
                enabled: false,
                dailyBudget: '100',
              };
      if (prior) await tx.update('settings', { key }, { valueJson, version: 1, updatedAt: now });
      else
        await tx.insert('settings', {
          key,
          valueJson,
          version: 1,
          updatedBy: null,
          createdAt: now,
          updatedAt: now,
        });
    }
  });
  const install = () =>
    auth.install(
      { extensionVersion: '0.0.1', consentVersion, consentAccepted: true },
      randomUUID(),
    );
  async function login(
    token?: string,
    link = false,
    email = randomUUID() + '@example.com',
    kind: 'extension' | 'web' = 'web',
  ) {
    const start = await auth.start(
      { email, clientKind: kind, deliveryLocale: 'en' },
      { token },
      randomUUID(),
    );
    return auth.verify(
      {
        challengeId: start.challengeId,
        code: mailer.outbox.at(-1)!.code,
        linkInstallationHistory: link,
      },
      { token, preAuth: start.preAuth },
      randomUUID(),
    );
  }
  const root = await login();
  await store.transaction((tx) => tx.update('users', { id: root.user.id }, { role: 'admin' }));
  const input = {
    product: normalizeShopify(readFileSync('tests/fixtures/shopify-ajax-multi.json', 'utf8'), {
      pageUrl: 'https://fixture.example/products/runad123-probe-trail-mug',
      currency: 'USD',
      method: 'ajax_js',
    }),
    draftContext: { targetCountry: 'US', language: 'preserve' },
  };
  const capture = (token: string) => products.capture(input, randomUUID(), token);
  async function approved(token: string) {
    await store.transaction(async (tx) => {
      const row = (await tx.find('settings', { key: 'ai_risk' }))[0]!;
      await tx.update(
        'settings',
        { key: 'ai_risk' },
        {
          valueJson: {
            ...disabledAiConfig,
            enabled: true,
            model: 'fixture',
            pricingVersion: 'fixture',
            inputPerMillion: '1',
            outputPerMillion: '2',
            dailyBudget: '100',
          },
          version: row.version + 1,
        },
      );
    });
    const c = await capture(token),
      request = await risk.start(
        c.preparedRevision.draftId,
        { revision: 1, reportLocale: 'en' },
        randomUUID(),
        token,
      );
    await new RiskWorker(
      risk,
      {
        run: async () => ({
          output: {
            assessment: 'no_obvious_signals',
            severity: 'low',
            findings: [],
            summary: 'Fixture only',
          },
          retryable: false,
          usage: { input: 10, output: 10 },
        }),
      },
      'm6-fixture',
    ).tick();
    const permit = await exports.permit(
      c.preparedRevision.draftId,
      {
        revision: 1,
        riskRequestId: request.aiRequestId,
        acknowledgedFindingIds: [],
        csvMappingVersion: 1,
      },
      randomUUID(),
      token,
    );
    await exports.download(
      permit.permitId,
      { clientEventId: randomUUID(), type: 'download_completed' },
      token,
    );
    return { capture: c, request, permit };
  }
  return {
    store,
    auth,
    admin,
    maintenance,
    products,
    risk,
    exports,
    root,
    install,
    login,
    capture,
    approved,
    now: () => now,
    advance: (days: number) => {
      now = new Date(+now + days * 86400000);
    },
  };
}
