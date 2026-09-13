import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { createAuthStore } from '../packages/db/src/index.js';
import { migrate } from '../packages/db/src/migrate.js';
import { MemberService } from '../packages/server-core/src/member.js';
import { m6Fixture } from '../tests/support/m6-fixture.js';
let stage = 'configuration';
async function main() {
  const uri = process.env.MYSQL_TEST_URL;
  if (!uri) {
    process.stdout.write('MEMBER_MYSQL_NOT_RUN: MYSQL_TEST_URL required\n');
    process.exitCode = 2;
    return;
  }
  const url = new URL(uri);
  if (url.protocol !== 'mysql:' || !/^\/runad123_test(?:_[a-z0-9]+)?$/.test(url.pathname))
    throw Error('ISOLATED_TEST_DATABASE_REQUIRED');
  stage = 'migration';
  await migrate(uri);
  stage = 'migration';
  await migrate(uri);
  const store = createAuthStore(uri);
  try {
    stage = 'fixture';
    const f = await m6Fixture(store),
      members = new MemberService(f.auth);
    const input = {
      email: randomUUID() + '@example.com',
      password: 'Synthetic-pass-42',
      confirmPassword: 'Synthetic-pass-42',
      purpose: 'Isolated review integration test',
      consentAccepted: true,
    };
    stage = 'register';
    await Promise.all([
      members.register(input, randomUUID()),
      members.register(input, randomUUID()),
    ]);
    const rows = await store.transaction((tx) =>
      tx.find('members', { emailNormalized: input.email }),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.userId, null);
    const login = { email: input.email, password: input.password };
    await assert.rejects(members.login(login, 'web', randomUUID()), {
      code: 'REGISTRATION_PENDING',
    });
    stage = 'review';
    const reviews = await Promise.allSettled([
      members.review(rows[0]!.id, { decision: 'approved' }, f.root.credential.token, randomUUID()),
      members.review(rows[0]!.id, { decision: 'rejected' }, f.root.credential.token, randomUUID()),
    ]);
    assert.equal(reviews.filter((r) => r.status === 'fulfilled').length, 1);
    const approved = (await store.transaction((tx) => tx.find('members', { id: rows[0]!.id })))[0]!;
    assert.equal(approved.state, 'approved');
    stage = 'login';
    const session = await members.login(login, 'web', randomUUID());
    assert.equal(session.user.role, 'user');
    assert.equal((await f.auth.me(session.credential.token)).user?.id, approved.userId);
    await assert.rejects(
      store.transaction((tx) => tx.update('members', { id: approved.id }, { userId: null })),
    );
    process.stdout.write(
      'MEMBER_MYSQL_PASSED: migration rerun, unique application, pending denial, concurrent review, password session, CHECK constraint\n',
    );
  } finally {
    await store.close();
  }
}
main().catch((error: unknown) => {
  const e = error as { code?: string; cause?: { code?: string } };
  const code = e.code ?? e.cause?.code ?? 'UNKNOWN';
  process.stderr.write(
    'Stage: ' + stage + '; code: ' + (/^[A-Z_0-9]+$/.test(code) ? code : 'REDACTED') + '\n',
  );
  process.stderr.write(
    'MEMBER_MYSQL_FAILED: inspect isolated test setup; credentials not logged\n',
  );
  process.exitCode = 1;
});
