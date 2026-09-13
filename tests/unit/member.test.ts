import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MemberService } from '../../packages/server-core/src/member.js';
import {
  AuthService,
  disabledMailer,
  createAuthHandler,
} from '../../packages/server-core/src/index.js';
import { MemoryAuthStore } from '../support/memory-auth-store.js';
import { m6Fixture } from '../support/m6-fixture.js';

const input = (email = 'applicant@example.com') => ({
  email,
  password: 'Synthetic-pass-42',
  confirmPassword: 'Synthetic-pass-42',
  purpose: 'Research products for my shop',
  consentAccepted: true,
});
async function setup() {
  const store = new MemoryAuthStore();
  const f = await m6Fixture(store);
  const auth = new AuthService(store, disabledMailer, f.auth.secret, f.now);
  return { ...f, auth, store, members: new MemberService(auth) };
}
describe('reviewed password registration without SMTP', () => {
  it('creates no user/session before approval, then permits login and revokes anonymous token', async () => {
    const f = await setup(),
      a = await f.install();
    const before = f.store.rows.sessions.length;
    await f.members.register(input(), 'ip', a.token);
    expect(f.store.rows.users).toHaveLength(1);
    expect(f.store.rows.sessions).toHaveLength(before);
    const row = f.store.rows.members[0]!;
    expect(row.userId).toBeNull();
    expect(row.passwordHash).toHaveLength(64);
    expect(JSON.stringify(row)).not.toContain(input().password);
    await expect(
      f.members.login(
        { email: input().email, password: input().password },
        'extension',
        'ip',
        a.token,
      ),
    ).rejects.toMatchObject({
      code: 'REGISTRATION_PENDING',
    });
    const listing = await f.members.list({}, f.root.credential.token);
    expect(listing.items[0]?.emailVerified).toBe(false);
    expect(JSON.stringify(listing)).not.toContain('password');
    await f.members.review(row.id, { decision: 'approved' }, f.root.credential.token, randomUUID());
    const login = await f.members.login(
      { email: input().email, password: input().password },
      'extension',
      'ip',
      a.token,
    );
    expect(login.user.role).toBe('user');
    expect((await f.auth.me(login.credential.token)).user?.id).toBe(login.user.id);
    await expect(f.auth.me(a.token)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(f.store.rows.audits.at(-1)?.action).toBe('member.review');
    expect(JSON.stringify(f.store.rows.audits)).not.toContain(input().password);
  });
  it('checks confirmation and password before revealing review state, and rejects denied/disabled users', async () => {
    const f = await setup();
    await expect(
      f.members.register({ ...input(), confirmPassword: 'different' }, 'ip'),
    ).rejects.toThrow();
    await f.members.register(input(), 'ip');
    await expect(
      f.members.login({ email: input().email, password: 'wrong' }, 'web', 'ip'),
    ).rejects.toMatchObject({ code: 'MEMBER_LOGIN_FAILED' });
    await f.members.review(
      f.store.rows.members[0]!.id,
      { decision: 'rejected', note: 'Insufficient purpose' },
      f.root.credential.token,
      randomUUID(),
    );
    await expect(
      f.members.login({ email: input().email, password: input().password }, 'web', 'ip'),
    ).rejects.toMatchObject({ code: 'REGISTRATION_REJECTED' });
    await f.members.register(input('second@example.com'), 'ip');
    const second = f.store.rows.members[1]!;
    await f.members.review(
      second.id,
      { decision: 'approved' },
      f.root.credential.token,
      randomUUID(),
    );
    await f.store.transaction((tx) =>
      tx.update('users', { id: f.store.rows.members[1]!.userId! }, { status: 'disabled' }),
    );
    await expect(
      f.members.login({ email: second.emailNormalized, password: input().password }, 'web', 'ip'),
    ).rejects.toMatchObject({ code: 'MEMBER_LOGIN_FAILED' });
  });
  it('rejects unauthorized review, prevents duplicate approval and never overwrites an existing password', async () => {
    const f = await setup(),
      a = await f.install();
    await Promise.all([f.members.register(input(), 'a'), f.members.register(input(), 'b')]);
    expect(f.store.rows.members).toHaveLength(1);
    const hash = f.store.rows.members[0]!.passwordHash;
    await f.members.register(
      { ...input(), password: 'Another-pass-42', confirmPassword: 'Another-pass-42' },
      'c',
    );
    expect(f.store.rows.members[0]!.passwordHash.equals(hash)).toBe(true);
    const id = f.store.rows.members[0]!.id;
    await expect(f.members.list({}, a.token)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      f.members.review(id, { decision: 'approved' }, a.token, randomUUID()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const results = await Promise.allSettled([
      f.members.review(id, { decision: 'approved' }, f.root.credential.token, randomUUID()),
      f.members.review(id, { decision: 'rejected' }, f.root.credential.token, randomUUID()),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(f.store.rows.users).toHaveLength(2);
    await f.members.register(input(f.root.user.email), 'other');
    expect(f.store.rows.members).toHaveLength(1);
  });
  it('limits automated applications by IP and repeated password attempts', async () => {
    const f = await setup();
    for (let i = 0; i < 5; i++)
      await f.members.register(input('person' + i + '@example.com'), 'same');
    await expect(f.members.register(input('overflow@example.com'), 'same')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    for (let i = 0; i < 5; i++)
      await expect(
        f.members.login({ email: 'unknown@example.com', password: 'wrong' }, 'web', 'login'),
      ).rejects.toMatchObject({ code: 'MEMBER_LOGIN_FAILED' });
    await expect(
      f.members.login({ email: 'unknown@example.com', password: 'wrong' }, 'web', 'login'),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
  it('enforces website CSRF, blocks old email endpoints and supports the login gate without mail', async () => {
    const f = await setup();
    const origin = 'https://runad.example';
    const handler = createAuthHandler(f.auth, {
      webOrigin: origin,
      extensionIds: [],
      production: true,
    });
    const csrfResponse = await handler(new Request(origin + '/api/v1/auth/csrf'));
    const csrf = (await csrfResponse.json()).data.csrfToken;
    const cookie = csrfResponse.headers.getSetCookie()[0]!.split(';')[0]!;
    const post = (path: string, body: unknown, proof = true) =>
      handler(
        new Request(origin + '/api/v1' + path, {
          method: 'POST',
          headers: {
            Origin: origin,
            Cookie: cookie,
            'Content-Type': 'application/json',
            ...(proof ? { 'X-CSRF-Token': csrf } : {}),
          },
          body: JSON.stringify(body),
        }),
      );
    expect((await post('/auth/registration', input(), false)).status).toBe(403);
    expect((await post('/auth/registration', input())).status).toBe(202);
    for (const path of ['/auth/email/start', '/auth/email/verify']) {
      const response = await post(path, {});
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe('REGISTRATION_REVIEW_REQUIRED');
    }
    const pending = await post('/auth/password/login', {
      email: input().email,
      password: input().password,
    });
    expect(pending.status).toBe(403);
    expect(pending.headers.getSetCookie()).toHaveLength(0);
    await f.members.review(
      f.store.rows.members[0]!.id,
      { decision: 'approved' },
      f.root.credential.token,
      randomUUID(),
    );
    const logged = await post('/auth/password/login', {
      email: input().email,
      password: input().password,
    });
    expect(logged.status).toBe(200);
    expect(
      logged.headers
        .getSetCookie()
        .some(
          (x) =>
            x.includes('__Host-runad-session=') && x.includes('HttpOnly') && x.includes('Secure'),
        ),
    ).toBe(true);
    await expect(
      f.auth.changeSettings(
        { accessMode: 'login_required', expectedVersion: 1 },
        f.root.credential.token,
        randomUUID(),
      ),
    ).resolves.toMatchObject({ accessMode: 'login_required' });
  });
});
