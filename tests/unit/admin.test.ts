import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { m6Fixture } from '../support/m6-fixture.js';
import { MemoryAuthStore } from '../support/memory-auth-store.js';
import { createAuthHandler, RiskWorker } from '../../packages/server-core/src/index.js';
import { adminDictionaries } from '../../packages/contracts/src/admin-i18n.js';
const article = {
  title: 'Import guide',
  summary: 'Check draft status',
  url: 'https://learn.example.com/import',
  contentLocale: 'en',
  category: 'shopify',
  placement: 'both',
  sortOrder: 0,
  enabled: true,
};
async function fixture() {
  const store = new MemoryAuthStore();
  return { ...(await m6Fixture(store)), store };
}
it('M6 tutorials enforce HTTPS exact hosts, revisions, locale cache isolation and live disable', async () => {
  const f = await fixture(),
    token = f.root.credential.token;
  for (const url of [
    'http://learn.example.com/x',
    'https://learn.example.com.evil.test/x',
    'https://user@learn.example.com/x',
    'https://learn.example.com:444/x',
    'https://learn.example.com/x#y',
  ])
    await expect(
      f.admin.saveTutorial(undefined, { ...article, url }, token, randomUUID()),
    ).rejects.toMatchObject({ code: 'TUTORIAL_URL_INVALID' });
  const a = await f.admin.saveTutorial(undefined, article, token, randomUUID());
  const en = await f.admin.tutorials({ locale: 'en' }),
    zh = await f.admin.tutorials({ locale: 'zh-Hant' });
  expect(en.items).toHaveLength(1);
  expect(zh.items[0]!.contentLocale).toBe('en');
  expect(en.etag).not.toBe(zh.etag);
  await expect(
    f.admin.saveTutorial(a.id, { ...article, expectedVersion: 9 }, token, randomUUID()),
  ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  await f.admin.saveTutorial(
    a.id,
    { ...article, enabled: false, expectedVersion: 1 },
    token,
    randomUUID(),
  );
  expect((await f.admin.tutorials({})).items).toEqual([]);
  expect((await f.admin.tutorials({}, true, token)).items).toHaveLength(1);
});
it('M6 public ETags and CORS are locale/page-specific; admin writes require CSRF and admin role', async () => {
  const f = await fixture(),
    token = f.root.credential.token,
    handle = createAuthHandler(f.auth, {
      webOrigin: 'https://app.example.com',
      extensionIds: ['a'.repeat(32)],
      production: false,
    });
  const get = (locale: string, etag?: string) =>
    handle(
      new Request('https://app.example.com/api/v1/tutorials?locale=' + locale, {
        headers: {
          origin: 'chrome-extension://' + 'a'.repeat(32),
          ...(etag ? { 'If-None-Match': etag } : {}),
        },
      }),
    );
  const first = await get('en'),
    tag = first.headers.get('etag')!;
  expect((await get('en', tag)).status).toBe(304);
  expect((await get('zh-Hans', tag)).status).toBe(200);
  const user = await f.login();
  await expect(f.admin.overview(user.credential.token)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  const post = await handle(
    new Request('https://app.example.com/api/v1/admin/tutorials', {
      method: 'POST',
      headers: {
        origin: 'https://app.example.com',
        cookie: 'runad-session=' + token,
        'content-type': 'application/json',
      },
      body: JSON.stringify(article),
    }),
  );
  expect(post.status).toBe(403);
});
it('M6 tutorial pagination changes ETag, stale cursor fails, removed allowlist hides content', async () => {
  const f = await fixture(),
    token = f.root.credential.token;
  for (let i = 0; i < 21; i++)
    await f.admin.saveTutorial(
      undefined,
      { ...article, title: 'Article ' + i, sortOrder: i },
      token,
      randomUUID(),
    );
  const a = await f.admin.tutorials({ locale: 'en' }),
    b = await f.admin.tutorials({ locale: 'en', cursor: a.nextCursor });
  expect(a.items).toHaveLength(20);
  expect(b.items).toHaveLength(1);
  expect(a.etag).not.toBe(b.etag);
  await f.admin.saveTutorial(undefined, { ...article, title: 'New' }, token, randomUUID());
  await expect(f.admin.tutorials({ locale: 'en', cursor: a.nextCursor })).rejects.toMatchObject({
    code: 'LIST_CHANGED',
  });
  const { riskEnabled, rewriteEnabled, ...limits } = await f.admin.limits(token);
  await f.admin.saveLimits({ ...limits, allowedTutorialHosts: [] }, token, randomUUID());
  expect((await f.admin.tutorials({})).items).toEqual([]);
});
it('M6 limits update shared budget atomically without enabling AI; unknown cost stays unknown', async () => {
  const f = await fixture(),
    token = f.root.credential.token,
    { riskEnabled, rewriteEnabled, ...limits } = await f.admin.limits(token);
  const saved = await f.admin.saveLimits(
    { ...limits, dailyBudget: '3.500000', riskAccount: 75 },
    token,
    randomUUID(),
  );
  expect(saved).toMatchObject({
    dailyBudget: '3.500000',
    riskAccount: 75,
    riskEnabled: false,
    rewriteEnabled: false,
    expectedVersion: 2,
  });
  await expect(f.admin.saveLimits(limits, token, randomUUID())).rejects.toMatchObject({
    code: 'REVISION_CONFLICT',
  });
  expect((await f.admin.overview(token)).knownCost).toBeNull();
  expect(f.store.rows.audits).toHaveLength(1);
  expect(JSON.stringify(f.store.rows.audits)).not.toContain(token);
});
it('M6 rolling statistics deduplicate across days and installations and keep anonymous/account facts separate', async () => {
  const f = await fixture(),
    a = await f.install(),
    b = await f.install();
  await f.capture(a.token);
  f.advance(1);
  await f.capture(a.token);
  const email = randomUUID() + '@example.com',
    u = await f.login(a.token, true, email, 'extension');
  f.advance(1 / 1000);
  const v = await f.login(b.token, false, email, 'extension');
  await f.capture(u.credential.token);
  await f.capture(v.credential.token);
  const r = (await f.admin.trending({ window: '7d', metric: 'capture' }, f.root.credential.token))
    .items[0]!;
  expect(r).toMatchObject({
    captureCount: 4,
    captureActors: 2,
    anonymousCaptureActors: 1,
    accountCaptureActors: 1,
    exportCount: 0,
    sampleInsufficient: true,
  });
  const event = f.store.rows.events[0]!;
  f.store.rows.events.push({
    ...event,
    id: randomUUID(),
    clientEventId: randomUUID(),
    receivedAt: new Date(+f.now() - 8 * 86400000),
  });
  expect((await f.admin.trending({}, f.root.credential.token)).items[0]!.captureCount).toBe(4);
});
it('M6 deletion preserves other owners sharing a snapshot and pauses writes until completion', async () => {
  const f = await fixture(),
    a = await f.install(),
    b = await f.install(),
    x = await f.capture(a.token),
    y = await f.capture(b.token);
  expect(f.store.rows.snapshots).toHaveLength(1);
  const d = await f.admin.deleteData(a.token);
  expect(await f.admin.deleteData(a.token)).toEqual(d);
  await expect(f.capture(a.token)).rejects.toMatchObject({ code: 'DATA_DELETION_PENDING' });
  for (let i = 0; i < 20; i++) await f.maintenance.personalBatch();
  expect(f.store.rows.deletions[0]!.state).toBe('complete');
  expect(f.store.rows.captures.map((c) => c.id)).toEqual([y.captureId]);
  expect(f.store.rows.snapshots).toHaveLength(1);
  await expect(f.products.get(x.preparedRevision.draftId, a.token)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  await f.capture(a.token);
});
it('M6 account deletion includes consent-linked history, not another account on the same installation', async () => {
  const f = await fixture(),
    a = await f.install();
  await f.capture(a.token);
  const u = await f.login(a.token, true, undefined, 'extension');
  await f.capture(u.credential.token);
  const other = await f.login(a.token, false, undefined, 'extension').catch(() => null);
  // Anonymous credential is revoked by linking, so it cannot assign history to another account.
  expect(other).toBeNull();
  const second = await f.login(u.credential.token, false, undefined, 'extension'),
    retained = await f.capture(second.credential.token);
  await f.admin.deleteData(u.credential.token);
  for (let i = 0; i < 20; i++) await f.maintenance.personalBatch();
  expect(f.store.rows.captures.map((c) => c.id)).toEqual([retained.captureId]);
  expect(f.store.rows.users.some((v) => v.id === u.user.id)).toBe(true);
  expect(f.store.rows.installations[0]!.linkedUserId).toBeNull();
});
it('M6 day 31 clears AI/draft bodies but keeps permit audit; day 91 clears references and latest snapshot', async () => {
  const f = await fixture(),
    a = await f.install(),
    done = await f.approved(a.token),
    hash = done.permit.exportHash;
  f.advance(31);
  for (let i = 0; i < 22; i++) await f.maintenance.retentionBatch();
  expect(f.store.rows.revisions[0]!.preparedProductJson).toBeNull();
  expect(f.store.rows.jobs[0]!.resultJson).toBeNull();
  expect(f.store.rows.permits[0]!.exportHash.toString('hex')).toBe(hash);
  expect(f.store.rows.events).toHaveLength(3);
  f.advance(60);
  for (let i = 0; i < 50; i++) await f.maintenance.retentionBatch();
  for (const key of [
    'events',
    'permits',
    'jobRequests',
    'jobAttempts',
    'jobs',
    'revisions',
    'drafts',
    'captures',
    'snapshots',
    'sourceProducts',
    'sourceStores',
  ] as const)
    expect(f.store.rows[key], key).toHaveLength(0);
});
it('M6 queued AI deletion settles reservations and rejects late download reports', async () => {
  const f = await fixture(),
    a = await f.install(),
    done = await f.approved(a.token);
  const c = await f.capture(a.token);
  await f.products.patch(
    c.preparedRevision.draftId,
    { expectedRevision: 1, title: 'A separate queued product' },
    a.token,
  );
  await f.risk.start(
    c.preparedRevision.draftId,
    { revision: 2, reportLocale: 'en' },
    randomUUID(),
    a.token,
  );
  await f.admin.deleteData(a.token);
  await expect(
    f.exports.download(
      done.permit.permitId,
      { clientEventId: randomUUID(), type: 'download_started' },
      a.token,
    ),
  ).rejects.toMatchObject({ code: 'DATA_DELETION_PENDING' });
  for (let i = 0; i < 30; i++) await f.maintenance.personalBatch();
  expect(f.store.rows.jobs).toHaveLength(0);
  expect(f.store.rows.permits).toHaveLength(0);
  expect(f.store.rows.usageCounters.every((c) => c.reservedCount === 0)).toBe(true);
});
it('M6 concurrent daily rollups reject stale computation and retain one product/day row', async () => {
  const f = await fixture(),
    a = await f.install();
  await f.capture(a.token);
  await f.auth.store.transaction((tx) =>
    f.maintenance.rollupState(tx, {
      day: f.now().toISOString().slice(0, 10),
      offset: 0,
      clearing: false,
    }),
  );
  await Promise.all([f.maintenance.rollup(), f.maintenance.rollup()]);
  expect(f.store.rows.dailyStats).toHaveLength(1);
  expect(f.store.rows.dailyStats[0]!.captureCount).toBe(1);
});
it('M6 all three admin dictionaries have identical keys and translated error fallbacks', () => {
  expect(Object.keys(adminDictionaries.en)).toEqual(Object.keys(adminDictionaries['zh-Hans']));
  expect(Object.keys(adminDictionaries.en)).toEqual(Object.keys(adminDictionaries['zh-Hant']));
  expect(adminDictionaries.en.UNKNOWN).toBeTruthy();
});

it('M6 an in-flight provider response cannot recreate personally deleted AI data', async () => {
  const f = await fixture(),
    a = await f.install();
  await f.approved(a.token);
  const c = await f.capture(a.token);
  await f.products.patch(
    c.preparedRevision.draftId,
    { expectedRevision: 1, title: 'Separate in-flight request' },
    a.token,
  );
  await f.risk.start(
    c.preparedRevision.draftId,
    { revision: 2, reportLocale: 'en' },
    randomUUID(),
    a.token,
  );
  let started!: () => void, release!: () => void;
  const ready = new Promise<void>((r) => {
      started = r;
    }),
    response = new Promise<void>((r) => {
      release = r;
    });
  const running = new RiskWorker(
    f.risk,
    {
      run: async () => {
        started();
        await response;
        return {
          output: {
            assessment: 'no_obvious_signals',
            severity: 'low',
            findings: [],
            summary: 'Late fixture result',
          },
          retryable: false,
          usage: { input: 10, output: 10 },
        };
      },
    },
    'deletion-fixture',
  ).tick();
  await ready;
  await f.admin.deleteData(a.token);
  for (let i = 0; i < 30; i++) await f.maintenance.personalBatch();
  release();
  await running;
  expect(f.store.rows.jobs).toHaveLength(0);
  expect(f.store.rows.jobAttempts).toHaveLength(0);
  expect(f.store.rows.jobRequests).toHaveLength(0);
  expect(f.store.rows.deletions[0]!.state).toBe('complete');
  expect(f.store.rows.usageCounters.some((c) => c.unknownCostCount > 0)).toBe(true);
});
