import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { createAuthStore } from '../packages/db/src/index.js';
import { migrate } from '../packages/db/src/migrate.js';
import { m6Fixture } from '../tests/support/m6-fixture.js';
async function main() {
  const uri = process.env.MYSQL_TEST_URL;
  if (!uri) {
    process.stdout.write('MYSQL_M6_NOT_RUN: MYSQL_TEST_URL required.\n');
    process.exitCode = 2;
    return;
  }
  const url = new URL(uri);
  if (url.protocol !== 'mysql:' || !/^\/runad123_test(?:_[a-z0-9]+)?$/.test(url.pathname))
    throw Error('ISOLATED_TEST_DATABASE_REQUIRED');
  await migrate(uri);
  const store = createAuthStore(uri);
  try {
    const f = await m6Fixture(store),
      a = await f.install(),
      b = await f.install(),
      x = await f.capture(a.token),
      y = await f.capture(b.token),
      token = f.root.credential.token;
    const tutorial = await f.admin.saveTutorial(
      undefined,
      {
        title: 'M6 fixture ' + randomUUID(),
        summary: 'Synthetic integration content',
        url: 'https://learn.example.com/import',
        contentLocale: 'en',
        category: 'shopify',
        placement: 'both',
        sortOrder: 0,
        enabled: true,
      },
      token,
      randomUUID(),
    );
    assert.ok((await f.admin.tutorials({}, true, token)).items.length > 0);
    const { riskEnabled, rewriteEnabled, ...limits } = await f.admin.limits(token);
    assert.equal(
      (await f.admin.saveLimits({ ...limits, dailyBudget: '2.500000' }, token, randomUUID()))
        .riskEnabled,
      false,
    );
    const trend = await f.admin.trending({ metric: 'capture' }, token);
    assert.ok(trend.items.some((i) => i.captureCount >= 2));
    const overview = await f.admin.overview(token);
    assert.equal(overview.knownCost, null);
    assert.ok(overview.daily.length > 0);
    await f.admin.deleteData(a.token);
    for (let i = 0; i < 1500; i++) {
      if (!(await f.maintenance.personalBatch())) break;
      if (i === 1499) throw Error('DELETION_DID_NOT_FINISH');
    }
    await store.transaction(async (tx) => {
      assert.equal((await tx.find('captures', { id: x.captureId })).length, 0);
      assert.equal((await tx.find('captures', { id: y.captureId })).length, 1);
      const other = (await tx.find('captures', { id: y.captureId }))[0]!;
      assert.equal((await tx.find('snapshots', { id: other.snapshotId })).length, 1);
    });
    const done = await f.approved(b.token);
    await store.transaction((tx) =>
      f.maintenance.rollupState(tx, {
        day: f.now().toISOString().slice(0, 10),
        offset: 0,
        clearing: false,
      }),
    );
    await Promise.all([f.maintenance.rollup(), f.maintenance.rollup()]);
    f.advance(31);
    for (let i = 0; i < 1500; i++) {
      await f.maintenance.retentionBatch();
      const ready = await store.transaction(async (tx) => {
        const permit = (await tx.find('permits', { id: done.permit.permitId }))[0]!;
        const revision = (await tx.find('revisions', { id: permit.draftRevisionId }))[0]!;
        const job = (await tx.find('jobRequests', { id: done.request.aiRequestId }))[0]!;
        return {
          purged:
            revision.preparedProductJson === null &&
            (await tx.find('jobs', { id: job.jobId }))[0]!.inputJson === null,
          hash: permit.exportHash.toString('hex'),
        };
      });
      assert.equal(ready.hash, done.permit.exportHash);
      if (ready.purged) break;
      if (i === 1499) throw Error('PAYLOAD_NOT_PURGED');
    }
    f.advance(60);
    let cleared = false;
    for (let i = 0; i < 2000; i++) {
      await f.maintenance.retentionBatch();
      cleared = await store.transaction(
        async (tx) =>
          (await tx.find('captures', { id: done.capture.captureId })).length === 0 &&
          (await tx.find('permits', { id: done.permit.permitId })).length === 0,
      );
      if (cleared && i > 40) break;
    }
    assert.equal(cleared, true);
    // Complete another cycle so snapshot latest pointers are exercised after capture dependencies vanish.
    for (let i = 0; i < 100; i++) await f.maintenance.retentionBatch();
    await store.transaction(async (tx) => {
      assert.equal(
        (await tx.find('drafts', { id: done.capture.preparedRevision.draftId })).length,
        0,
      );
      assert.equal((await tx.find('jobRequests', { id: done.request.aiRequestId })).length, 0);
      assert.equal((await tx.find('captures', { id: y.captureId })).length, 0);
      await tx.delete('tutorials', { id: tutorial.id });
    });
    process.stdout.write(
      'MYSQL_M6_PASSED: real migrations, tutorial/config transactions, SQL distinct counts and cost/daily aggregates, shared snapshot isolation, concurrent rollups, day-31 payload purge with permit audit, day-91 FK cleanup. Clock/AI/mail simulated; only isolated test records affected.\n',
    );
  } finally {
    await store.close();
  }
}
void main().catch((error: unknown) => {
  if (error instanceof Error)
    process.stderr.write(
      error.name +
        '\n' +
        (error.stack
          ?.split('\n')
          .filter((l) => l.trim().startsWith('at '))
          .join('\n') ?? '') +
        '\n',
    );
  process.stderr.write('MYSQL_M6_FAILED: values, credentials and payloads redacted.\n');
  process.exitCode = 1;
});
