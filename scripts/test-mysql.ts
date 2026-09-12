import { readFileSync } from 'node:fs';
import { normalizeShopify } from '../packages/product-core/src/index.js';
import {
  ExportService,
  RiskService,
  RiskWorker,
  disabledAiConfig,
} from '../packages/server-core/src/index.js';
import { ProductService } from '../packages/server-core/src/products.js';
import { randomUUID } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { createAuthStore } from '../packages/db/src/index.js';
import { migrate } from '../packages/db/src/migrate.js';
import { AuthService, createMemoryMailer, secretToken } from '../packages/server-core/src/index.js';
import { consentVersion } from '../packages/contracts/src/auth.js';

async function main() {
  const uri = process.env.MYSQL_TEST_URL;
  if (!uri) {
    process.stdout.write('MYSQL_INTEGRATION_NOT_RUN: MYSQL_TEST_URL is required.\n');
    process.exitCode = 2;
    return;
  }
  const url = new URL(uri);
  if (url.protocol !== 'mysql:' || !/^\/runad123_test(?:_[a-z0-9]+)?$/.test(url.pathname))
    throw new Error('ISOLATED_TEST_DATABASE_REQUIRED');
  // Explicitly provision this isolated schema first. Never create/drop a user's database.
  await migrate(uri);
  await migrate(uri);
  const store = createAuthStore(uri),
    other = createAuthStore(uri),
    mailer = createMemoryMailer('test'),
    secret = secretToken();
  const service = new AuthService(store, mailer, secret),
    second = new AuthService(other, mailer, secret);
  const marker = randomUUID();
  try {
    const install = await service.install(
      { extensionVersion: '0.0.1', consentAccepted: true, consentVersion },
      marker,
    );
    assert.equal((await service.me(install.token)).user, null);
    const start = await service.start(
      { email: `${marker}@example.com`, clientKind: 'extension', deliveryLocale: 'en' },
      { token: install.token },
      marker,
    );
    const input = {
      challengeId: start.challengeId,
      code: mailer.outbox.at(-1)!.code,
      linkInstallationHistory: true,
    };
    const attempts = await Promise.allSettled([
      service.verify(input, { token: install.token }, marker),
      second.verify(input, { token: install.token }, marker),
    ]);
    assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
    const verified = attempts.find((result) => result.status === 'fulfilled');
    assert.ok(verified?.status === 'fulfilled');
    const token = verified.value.credential.token;
    const products = new ProductService(service),
      products2 = new ProductService(second);
    const product = normalizeShopify(
      readFileSync('tests/fixtures/shopify-ajax-multi.json', 'utf8'),
      {
        pageUrl: 'https://fixture.example/products/runad123-probe-trail-mug',
        currency: 'USD',
        method: 'ajax_js',
      },
    );
    const captureInput = { product, draftContext: { targetCountry: 'US', language: 'preserve' } };
    const key = randomUUID();
    const [first, retry] = await Promise.all([
      products.capture(captureInput, key, token),
      products2.capture(captureInput, key, token),
    ]);
    assert.equal(first.captureId, retry.captureId);
    const distinct = await products.capture(captureInput, randomUUID(), token);
    assert.notEqual(first.captureId, distinct.captureId);
    await store.transaction(async (tx) => {
      const a = (await tx.find('captures', { id: first.captureId }))[0]!;
      const b = (await tx.find('captures', { id: distinct.captureId }))[0]!;
      assert.equal(a.snapshotId, b.snapshotId);
      assert.equal((await tx.find('events', { captureId: first.captureId })).length, 1);
    });
    const draftId = first.preparedRevision.draftId;
    const edits = await Promise.allSettled([
      products.patch(draftId, { expectedRevision: 1, title: 'First change' }, token),
      products2.patch(draftId, { expectedRevision: 1, title: 'Second change' }, token),
    ]);
    assert.equal(edits.filter((r) => r.status === 'fulfilled').length, 1);
    const rejected = edits.find((r) => r.status === 'rejected');
    assert.equal(
      rejected?.status === 'rejected' ? rejected.reason.code : null,
      'REVISION_CONFLICT',
    );
    assert.equal((await products.get(draftId, token)).preparedRevision.revision, 2);
    await store.transaction(async (tx) => {
      const old = (await tx.find('revisions', { draftId, revision: 1 }))[0]!;
      assert.equal(old.textHash.toString('hex'), first.preparedRevision.textHash);
    });
    const stranger = await service.install(
      { extensionVersion: '0.0.1', consentAccepted: true, consentVersion },
      randomUUID(),
    );
    await assert.rejects(products.get(draftId, stranger.token), { code: 'NOT_FOUND' });
    await store.transaction((tx) =>
      tx.update(
        'settings',
        { key: 'ai_risk' },
        {
          valueJson: {
            ...disabledAiConfig,
            enabled: true,
            model: 'fixture-model',
            pricingVersion: 'test-only',
            inputPerMillion: '1',
            outputPerMillion: '2',
            dailyBudget: '100',
            anonymousDaily: 1000,
            accountDaily: 10000,
          },
        },
      ),
    );
    const risk = new RiskService(service),
      risk2 = new RiskService(second),
      riskKey = randomUUID();
    const riskInput = { revision: 2, reportLocale: 'en' };
    const [ra, rb] = await Promise.all([
      risk.start(draftId, riskInput, riskKey, token),
      risk2.start(draftId, riskInput, riskKey, token),
    ]);
    assert.equal(ra.aiRequestId, rb.aiRequestId);
    const [claimA, claimB] = await Promise.all([
      store.claimJob('test-a', new Date()),
      other.claimJob('test-b', new Date()),
    ]);
    assert.equal([claimA, claimB].filter(Boolean).length, 1);
    const claim = (claimA ?? claimB)!;
    await store.transaction((tx) =>
      tx.update('jobs', { id: claim.id }, { leaseUntil: new Date(Date.now() - 1000) }),
    );
    const worker = new RiskWorker(
      risk,
      {
        run: async () => ({
          output: {
            assessment: 'no_obvious_signals',
            severity: 'low',
            findings: [],
            summary: 'Synthetic provider response',
          },
          usage: { input: 100, output: 50 },
          retryable: false,
        }),
      },
      'mysql-fixture-worker',
    );
    await worker.tick();
    assert.equal((await risk.status(ra.aiRequestId, token)).state, 'succeeded');
    assert.equal(await store.renewJob(claim.id, claim.leaseToken!, new Date()), false);
    const hit = await risk.start(draftId, riskInput, randomUUID(), token);
    assert.equal(hit.cacheHit, true);
    await store.transaction(async (tx) => {
      const c = (await tx.find('settings', { key: 'ai_risk' }))[0]!;
      await tx.update(
        'settings',
        { key: 'ai_rewrite' },
        { valueJson: { ...(c.valueJson as Record<string, unknown>), promptVersion: 'rewrite-v1' } },
      );
    });
    const rewrite = new RiskService(service, 'rewrite');
    const rewriteInput = {
      revision: 2,
      reportLocale: 'zh-Hans',
      language: 'preserve',
      rewriteTitle: true,
      rewriteDescription: false,
    };
    const rewriteKey = randomUUID();
    const [rewriteA, rewriteB] = await Promise.all([
      rewrite.start(draftId, rewriteInput, rewriteKey, token),
      new RiskService(second, 'rewrite').start(draftId, rewriteInput, rewriteKey, token),
    ]);
    assert.equal(rewriteA.aiRequestId, rewriteB.aiRequestId);
    const original = (await products.get(draftId, token)).preparedRevision;
    await new RiskWorker(
      risk,
      {
        run: async () => ({
          rewrite: {
            title: 'Portable mug 750 ml',
            changeSummary: ['Fixture change'],
            factualWarnings: [],
          },
          usage: { input: 100, output: 50 },
          retryable: false,
        }),
      },
      'mysql-rewrite-fixture',
    ).tick();
    const rewritten = await rewrite.status(rewriteA.aiRequestId, token);
    assert.equal(rewritten.state, 'succeeded');
    assert.ok(rewritten.result?.warnings.includes('NUMERIC_FACTS_CHANGED'));
    assert.deepEqual((await products.get(draftId, token)).preparedRevision, original);
    const accepted = (
      await products.patch(
        draftId,
        { expectedRevision: 2, title: rewritten.result!.output.title },
        token,
      )
    ).preparedRevision;
    assert.equal(accepted.revision, 3);
    assert.equal(
      accepted.preparedProduct.descriptionHtml,
      original.preparedProduct.descriptionHtml,
    );
    assert.equal((await risk.status(ra.aiRequestId, token)).current, false);
    await assert.rejects(products.patch(draftId, { expectedRevision: 2, title: 'Stale' }, token), {
      code: 'REVISION_CONFLICT',
    });
    await store.transaction(async (tx) => {
      const globals = await tx.find('usageCounters', { subjectType: 'global', operation: 'ai' });
      assert.ok(globals.length > 0);
      assert.equal(
        (await tx.find('usageCounters', { subjectType: 'global', operation: 'risk_check' })).length,
        0,
      );
      const requests = await tx.find('jobRequests', { id: rewriteA.aiRequestId });
      const job = (await tx.find('jobs', { id: requests[0]!.jobId }))[0]!;
      assert.equal(job.kind, 'rewrite');
      assert.equal(job.estimatedCost, '0.000200');
    });
    const finalRisk = await risk.start(
      draftId,
      { revision: 3, reportLocale: 'en' },
      randomUUID(),
      token,
    );
    await worker.tick();
    const exporter = new ExportService(service),
      exportKey = randomUUID();
    const exportInput = {
      revision: 3,
      riskRequestId: finalRisk.aiRequestId,
      acknowledgedFindingIds: [],
      csvMappingVersion: 1,
    };
    const [permitA, permitB] = await Promise.all([
      exporter.permit(draftId, exportInput, exportKey, token),
      new ExportService(second).permit(draftId, exportInput, exportKey, token),
    ]);
    assert.equal(permitA.permitId, permitB.permitId);
    const event = { type: 'download_completed', clientEventId: randomUUID() };
    await Promise.all([
      exporter.download(permitA.permitId, event, token),
      new ExportService(second).download(permitA.permitId, event, token),
    ]);
    await store.transaction(async (tx) => {
      assert.equal(
        (
          await tx.find('events', {
            exportPermitId: permitA.permitId,
            eventType: 'download_completed',
          })
        ).length,
        1,
      );
    });
    const limits = await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) =>
        (index % 2 ? service : second).rate([[marker, 60, 3]]),
      ),
    );
    assert.equal(limits.filter((result) => result.status === 'fulfilled').length, 3);
    const before = await service.config();
    try {
      await store.transaction(async (tx) => {
        await tx.update('settings', { key: 'access_mode' }, { version: 999999 });
        throw new Error('rollback-fixture');
      });
    } catch {}
    assert.equal((await service.config()).configVersion, before.configVersion);
    process.stdout.write(
      'MYSQL_INTEGRATION_PASSED: migrations/idempotent rerun, binary token round-trip, concurrent verification/rate limiting, capture deduplication, immutable revision conflicts, ownership, rollback, risk deduplication, SKIP LOCKED claims, lease recovery/fencing, risk result caching, rewrite deduplication/settlement, explicit acceptance/conflicts, shared global AI counter, export permit/event concurrency and foreign keys. SMTP and AI provider remain simulated.\n',
    );
  } finally {
    await store.close();
    await other.close();
  }
}
void main().catch((error: unknown) => {
  if (error instanceof Error)
    process.stderr.write(
      error.name +
        '\n' +
        (error.stack
          ?.split('\n')
          .filter((line) => line.trim().startsWith('at '))
          .join('\n') ?? '') +
        '\n',
    );
  process.stderr.write(
    'MYSQL_INTEGRATION_FAILED: inspect isolated test database; credentials and codes are redacted.\n',
  );
  process.exitCode = 1;
});
