import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  AuthService,
  createMemoryMailer,
  disabledMailer,
  secretToken,
  digest,
  createAuthHandler,
  hashAdminPassword,
} from '../../packages/server-core/src/index.js';
import { MemoryAuthStore } from '../support/memory-auth-store.js';
import { consentVersion, emailStartInput } from '../../packages/contracts/src/auth.js';
import { authDictionaries } from '../../packages/contracts/src/auth-i18n.js';

function setup() {
  const store = new MemoryAuthStore(),
    mailer = createMemoryMailer('test');
  let time = Date.now();
  const service = new AuthService(store, mailer, secretToken(), () => new Date(time));
  const install = () =>
    service.install(
      { extensionVersion: '0.0.1', consentVersion, consentAccepted: true },
      'fixture-ip',
    );
  async function login(
    token: string | undefined,
    link = false,
    email = 'buyer@example.com',
    kind: 'extension' | 'web' = 'extension',
  ) {
    const start = await service.start(
      { email, clientKind: kind, deliveryLocale: 'zh-Hant' },
      { token },
      'fixture-ip',
    );
    const code = mailer.outbox.at(-1)!.code;
    const result = await service.verify(
      { challengeId: start.challengeId, code, linkInstallationHistory: link },
      { token, preAuth: start.preAuth },
      'fixture-ip',
    );
    return result;
  }
  return {
    store,
    mailer,
    service,
    install,
    login,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
describe('M1 business rules — transaction model, not live MySQL', () => {
  it('issues an anonymous credential and stores only its digest', async () => {
    const f = setup(),
      a = await f.install();
    expect(a.token.length).toBe(43);
    expect(f.store.rows.sessions[0]!.tokenHash.equals(digest(a.token))).toBe(true);
    expect((await f.service.me(a.token)).user).toBeNull();
    expect(f.store.rows.installations[0]!.consentVersion).toBe(consentVersion);
    await expect(f.service.me(a.installationId!)).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
  });
  it('validates explicit consent and refuses client chosen identities', async () => {
    const f = setup();
    await expect(
      f.service.install(
        { extensionVersion: '0.0.1', consentVersion, consentAccepted: false } as never,
        'ip',
      ),
    ).rejects.toBeDefined();
    expect(f.store.rows.installations).toHaveLength(0);
  });
  it('extends the same token idempotently; expired and revoked cannot renew', async () => {
    const f = setup(),
      a = await f.install();
    f.advance(86400000);
    const first = await f.service.renew(a.token),
      second = await f.service.renew(a.token);
    expect(first).toEqual(second);
    expect(f.store.rows.sessions).toHaveLength(1);
    expect(f.store.rows.sessions[0]!.tokenHash.equals(digest(a.token))).toBe(true);
    f.advance(91 * 86400000);
    await expect(f.service.renew(a.token)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });
  it('commits failed attempts and locks after five wrong codes', async () => {
    const f = setup(),
      a = await f.install(),
      c = await f.service.start(
        { email: 'a@example.com', clientKind: 'extension', deliveryLocale: 'en' },
        { token: a.token },
        'ip',
      );
    const code = f.mailer.outbox[0]!.code,
      wrong = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++)
      await expect(
        f.service.verify(
          { challengeId: c.challengeId, code: wrong, linkInstallationHistory: false },
          { token: a.token },
          'ip',
        ),
      ).rejects.toMatchObject({ code: 'CODE_INVALID' });
    expect(f.store.rows.challenges[0]!.attempts).toBe(5);
    await expect(
      f.service.verify(
        { challengeId: c.challengeId, code, linkInstallationHistory: false },
        { token: a.token },
        'ip',
      ),
    ).rejects.toMatchObject({ code: 'CODE_INVALID' });
  });
  it('binds extension verification to the original installation', async () => {
    const f = setup(),
      a = await f.install(),
      b = await f.install(),
      c = await f.service.start(
        { email: 'a@example.com', clientKind: 'extension', deliveryLocale: 'en' },
        { token: a.token },
        'ip',
      );
    await expect(
      f.service.verify(
        {
          challengeId: c.challengeId,
          code: f.mailer.outbox[0]!.code,
          linkInstallationHistory: true,
        },
        { token: b.token },
        'ip',
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.store.rows.users).toHaveLength(0);
  });
  it('binds website challenges to pre-auth proof and freezes language', async () => {
    const f = setup(),
      c = await f.service.start(
        { email: 'a@example.com', clientKind: 'web', deliveryLocale: 'zh-Hant' },
        {},
        'ip',
      );
    expect(f.mailer.outbox[0]!.locale).toBe('zh-Hant');
    await expect(
      f.service.verify(
        {
          challengeId: c.challengeId,
          code: f.mailer.outbox[0]!.code,
          linkInstallationHistory: false,
        },
        { preAuth: secretToken() },
        'ip',
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('consumes once even under concurrent verification', async () => {
    const f = setup(),
      a = await f.install(),
      c = await f.service.start(
        { email: 'a@example.com', clientKind: 'extension', deliveryLocale: 'en' },
        { token: a.token },
        'ip',
      );
    const input = {
      challengeId: c.challengeId,
      code: f.mailer.outbox[0]!.code,
      linkInstallationHistory: false,
    };
    const results = await Promise.allSettled([
      f.service.verify(input, { token: a.token }, 'ip'),
      f.service.verify(input, { token: a.token }, 'ip'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(f.store.rows.users).toHaveLength(1);
  });
  it('expires codes and throttles resend without exposing account existence', async () => {
    const f = setup(),
      input = { email: 'a@example.com', clientKind: 'web' as const, deliveryLocale: 'en' as const };
    const c = await f.service.start(input, {}, 'ip');
    await expect(f.service.start(input, {}, 'ip')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    f.advance(600001);
    await expect(
      f.service.verify(
        {
          challengeId: c.challengeId,
          code: f.mailer.outbox[0]!.code,
          linkInstallationHistory: false,
        },
        { preAuth: c.preAuth },
        'ip',
      ),
    ).rejects.toMatchObject({ code: 'CODE_INVALID' });
  });
  it('allows account recovery with a fresh challenge after lost verify response', async () => {
    const f = setup(),
      a = await f.install(),
      first = await f.login(a.token, false);
    f.advance(61000);
    const next = await f.login(a.token, false);
    expect(next.user.id).toBe(first.user.id);
    expect(f.store.rows.users).toHaveLength(1);
  });
  it('does not link history without consent; logging out returns anonymous context', async () => {
    const f = setup(),
      a = await f.install(),
      login = await f.login(a.token, false),
      draft = { userId: null, installationId: a.installationId! };
    const allowed = await f.store.transaction(async (tx) =>
      f.service.owns(tx, await f.service.authenticate(tx, login.credential.token), draft),
    );
    expect(allowed).toBe(false);
    expect(f.store.rows.installations[0]!.linkedUserId).toBeNull();
    const logout = await f.service.logout(login.credential.token);
    expect(logout.credential?.installationId).toBe(a.installationId);
    await expect(f.service.me(login.credential.token)).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
  });
  it('links history for cross-device owner access, revokes anonymous token, isolates next logout', async () => {
    const f = setup(),
      a = await f.install(),
      login = await f.login(a.token, true),
      draft = { userId: null, installationId: a.installationId! };
    await expect(f.service.me(a.token)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    f.advance(61000);
    const web = await f.login(undefined, false, 'buyer@example.com', 'web');
    expect(
      await f.store.transaction(async (tx) =>
        f.service.owns(tx, await f.service.authenticate(tx, web.credential.token), draft),
      ),
    ).toBe(true);
    const logout = await f.service.logout(login.credential.token);
    expect(logout.credential?.installationId === a.installationId).toBe(false);
    expect(
      await f.store.transaction(async (tx) =>
        f.service.owns(tx, await f.service.authenticate(tx, logout.credential!.token), draft),
      ),
    ).toBe(false);
  });
  it('another account cannot take ownership of linked history', async () => {
    const f = setup(),
      a = await f.install(),
      login = await f.login(a.token, true);
    await expect(f.login(login.credential.token, true, 'other@example.com')).rejects.toMatchObject({
      code: 'HISTORY_ALREADY_LINKED',
    });
    expect(f.store.rows.users).toHaveLength(1);
  });
  it('disabled users and installations invalidate active credentials', async () => {
    const f = setup(),
      a = await f.install(),
      login = await f.login(a.token);
    f.store.rows.users[0]!.status = 'disabled';
    await expect(f.service.renew(login.credential.token)).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
    f.store.rows.installations[0]!.status = 'disabled';
    await expect(f.service.me(a.token)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });
  it('gate blocks core writes while allowing existing anonymous reads', async () => {
    const f = setup(),
      a = await f.install();
    f.store.rows.settings[0]!.valueJson = 'login_required';
    expect((await f.service.me(a.token)).loginRequired).toBe(true);
    await expect(
      f.store.transaction((tx) => f.service.authorize(tx, a.token, 'core')),
    ).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' });
  });
  it('only web admins can change settings without requiring SMTP', async () => {
    const f = setup(),
      a = await f.install(),
      login = await f.login(a.token);
    await expect(
      f.service.changeSettings(
        { accessMode: 'anonymous_allowed', expectedVersion: 1 },
        login.credential.token,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    f.store.rows.users[0]!.role = 'admin';
    await expect(f.service.adminSettings(login.credential.token)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    f.advance(61000);
    const web = await f.login(undefined, false, 'buyer@example.com', 'web');
    await f.service.changeSettings(
      { accessMode: 'login_required', expectedVersion: 1 },
      web.credential.token,
      randomUUID(),
    );
    expect(f.store.rows.audits).toHaveLength(1);
    await expect(
      f.service.changeSettings(
        { accessMode: 'anonymous_allowed', expectedVersion: 1 },
        web.credential.token,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' });
  });
  it('atomic buckets do not allow parallel requests over the limit', async () => {
    const f = setup(),
      results = await Promise.allSettled(
        Array.from({ length: 12 }, () => f.service.rate([['test', 60, 3]])),
      );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(f.store.rows.buckets[0]!.count).toBe(3);
  });
  it('failed sends are never verifiable; production disallows memory mail', async () => {
    const f = setup(),
      service = new AuthService(
        f.store,
        {
          kind: 'smtp',
          async send() {
            throw new Error('provider-detail');
          },
          async verify() {
            return false;
          },
        },
        secretToken(),
      );
    await expect(
      service.start({ email: 'a@example.com', clientKind: 'web', deliveryLocale: 'en' }, {}, 'ip'),
    ).rejects.toMatchObject({ code: 'EMAIL_UNAVAILABLE' });
    expect(f.store.rows.challenges[0]!.state).toBe('failed');
    expect(() => createMemoryMailer('production')).toThrow('MEMORY_MAIL_FORBIDDEN');
    const disabled = new AuthService(f.store, disabledMailer, secretToken());
    await expect(
      disabled.start({ email: 'a@example.com', clientKind: 'web', deliveryLocale: 'en' }, {}, 'ip'),
    ).rejects.toMatchObject({ code: 'EMAIL_UNAVAILABLE' });
  });
  it('normalizes email without removing dot or plus aliases; dictionaries match', () => {
    expect(
      emailStartInput.parse({
        email: 'Test.Name+tag@Example.com',
        clientKind: 'web',
        deliveryLocale: 'en',
      }).email,
    ).toBe('test.name+tag@example.com');
    expect(Object.keys(authDictionaries['zh-Hans']).sort()).toEqual(
      Object.keys(authDictionaries.en).sort(),
    );
    expect(Object.keys(authDictionaries['zh-Hant']).sort()).toEqual(
      Object.keys(authDictionaries.en).sort(),
    );
  });
});

describe('M1 HTTP transport — transaction model', () => {
  it('SMTP readiness and admin version checks protect a live gate transition (simulated SMTP)', async () => {
    const f = setup();
    const login = await f.login(undefined, false, 'admin@example.com', 'web');
    f.store.rows.users[0]!.role = 'admin';
    const service = new AuthService(
      f.store,
      {
        kind: 'smtp',
        send: (mail) => f.mailer.send(mail),
        async verify() {
          return true;
        },
      },
      secretToken(),
    );
    const anonymous = await f.install();
    await service.changeSettings(
      { accessMode: 'login_required', expectedVersion: 1 },
      login.credential.token,
      randomUUID(),
    );
    await expect(
      f.store.transaction((tx) => service.authorize(tx, anonymous.token, 'core')),
    ).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' });
    await service.changeSettings(
      { accessMode: 'anonymous_allowed', expectedVersion: 2 },
      login.credential.token,
      randomUUID(),
    );
    await expect(
      f.store.transaction((tx) => service.authorize(tx, anonymous.token, 'core')),
    ).resolves.toBeDefined();
    expect(f.store.rows.audits).toHaveLength(2);
  });
  it('supports admin password login without SMTP and rejects non-admin credentials', async () => {
    const f = setup(),
      login = await f.login(undefined, false, 'admin@example.com', 'web');
    f.store.rows.users[0]!.role = 'admin';
    const password = await hashAdminPassword('StrongPass123');
    await f.store.transaction((tx) =>
      tx.insert('adminCredentials', {
        userId: login.user.id,
        loginNormalized: 'admin@example.com',
        passwordSalt: password.salt,
        passwordHash: password.hash,
        passwordVersion: password.version,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    await expect(
      f.service.adminPasswordLogin({ login: 'admin@example.com', password: 'wrong-pass' }, 'ip'),
    ).rejects.toMatchObject({ code: 'ADMIN_LOGIN_FAILED' });
    f.store.rows.users[0]!.role = 'user';
    await expect(
      f.service.adminPasswordLogin({ login: 'admin@example.com', password: 'StrongPass123' }, 'ip'),
    ).rejects.toMatchObject({ code: 'ADMIN_LOGIN_FAILED' });
    f.store.rows.users[0]!.role = 'admin';
    const result = await f.service.adminPasswordLogin(
      { login: 'admin@example.com', password: 'StrongPass123' },
      'ip',
    );
    expect(result.user.role).toBe('admin');
    expect(f.store.rows.sessions.at(-1)!.kind).toBe('web');
  });

  it('admin password HTTP login sets only the web session cookie', async () => {
    const f = setup(),
      login = await f.login(undefined, false, 'admin@example.com', 'web');
    f.store.rows.users[0]!.role = 'admin';
    const password = await hashAdminPassword('StrongPass123');
    await f.store.transaction((tx) =>
      tx.insert('adminCredentials', {
        userId: login.user.id,
        loginNormalized: 'admin@example.com',
        passwordSalt: password.salt,
        passwordHash: password.hash,
        passwordVersion: password.version,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    const handle = createAuthHandler(f.service, {
      webOrigin: 'https://runad.example',
      extensionIds: [],
      production: true,
    });
    const csrfResponse = await handle(new Request('https://runad.example/api/v1/auth/csrf'));
    const jar = csrfResponse.headers.get('set-cookie')!.split(';')[0]!,
      csrf = (await csrfResponse.json()).data.csrfToken;
    const response = await handle(
      new Request('https://runad.example/api/v1/auth/admin/login', {
        method: 'POST',
        headers: {
          Origin: 'https://runad.example',
          Cookie: jar,
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify({ login: 'admin@example.com', password: 'StrongPass123' }),
      }),
    );
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie().join(' ');
    expect(cookies.includes('__Host-runad-session')).toBe(true);
    expect((await response.json()).data.user.role).toBe('admin');
  });

  it('disables legacy email endpoints rather than bypassing administrator review', async () => {
    const f = setup();
    const handle = createAuthHandler(f.service, {
      webOrigin: 'https://runad.example',
      extensionIds: [],
      production: true,
    });
    const proof = await handle(new Request('https://runad.example/api/v1/auth/csrf'));
    const headers = {
      Origin: 'https://runad.example',
      'Content-Type': 'application/json',
      Cookie: proof.headers.getSetCookie()[0]!.split(';')[0]!,
      'X-CSRF-Token': (await proof.json()).data.csrfToken,
    };
    for (const endpoint of ['start', 'verify']) {
      const response = await handle(
        new Request('https://runad.example/api/v1/auth/email/' + endpoint, {
          method: 'POST',
          headers,
          body: '{}',
        }),
      );
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe('REGISTRATION_REVIEW_REQUIRED');
      expect(response.headers.getSetCookie()).toHaveLength(0);
    }
    expect(f.mailer.outbox).toHaveLength(0);
  });
  it('rejects hostile origins, missing CSRF, forged role and unapproved extensions', async () => {
    const f = setup(),
      handle = createAuthHandler(f.service, {
        webOrigin: 'https://runad.example',
        extensionIds: [],
        production: true,
      });
    for (const origin of ['https://evil.example', 'chrome-extension://' + 'b'.repeat(32)]) {
      const result = await handle(
        new Request('https://runad.example/api/v1/installations', {
          method: 'POST',
          headers: { Origin: origin },
        }),
      );
      expect(result.status).toBe(403);
    }
    const result = await handle(
      new Request('https://runad.example/api/v1/auth/email/start', {
        method: 'POST',
        headers: { Origin: 'https://runad.example', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'a@example.com',
          clientKind: 'web',
          deliveryLocale: 'en',
          role: 'admin',
        }),
      }),
    );
    expect(result.status).toBe(403);
  });
  it('actual HTTP access probe enforces the current server gate', async () => {
    const f = setup(),
      a = await f.install(),
      handle = createAuthHandler(f.service, {
        webOrigin: 'https://runad.example',
        extensionIds: ['a'.repeat(32)],
        production: true,
      });
    const request = () =>
      new Request('https://runad.example/api/v1/access/check', {
        method: 'POST',
        headers: {
          Origin: 'chrome-extension://' + 'a'.repeat(32),
          Authorization: 'Bearer ' + a.token,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
    expect((await handle(request())).status).toBe(200);
    f.store.rows.settings[0]!.valueJson = 'login_required';
    const blocked = await handle(request());
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error.code).toBe('LOGIN_REQUIRED');
  });
  it('redacts unexpected storage errors', async () => {
    const f = setup();
    f.store.transaction = async () => {
      throw new Error('private diagnostic');
    };
    const response = await createAuthHandler(f.service, {
      webOrigin: 'https://runad.example',
      extensionIds: [],
      production: true,
    })(new Request('https://runad.example/api/v1/config'));
    expect(response.status).toBe(503);
    expect((await response.text()).includes('private diagnostic')).toBe(false);
  });
});

it('accepts Chrome-assigned IDs only in explicit loopback preview, retaining auth', async () => {
  const f = setup();
  const dynamicOrigin = 'chrome-extension://' + 'p'.repeat(32);
  const check = (
    localPreview: boolean,
    production: boolean,
    webOrigin: string,
    requestOrigin: string,
    origin = dynamicOrigin,
    route = '/config',
    method = 'GET',
  ) =>
    createAuthHandler(f.service, { extensionIds: [], localPreview, production, webOrigin })(
      new Request(requestOrigin + '/api/v1' + route, { method, headers: { Origin: origin } }),
    );
  const local = 'http://127.0.0.1:3000';
  expect((await check(true, false, local, 'http://localhost:3000')).status).toBe(200);
  const accepted = await check(true, false, local, local);
  expect(accepted.status).toBe(200);
  expect(accepted.headers.get('Access-Control-Allow-Origin')).toBe(dynamicOrigin);
  expect((await check(true, false, local, local, dynamicOrigin, '/config', 'OPTIONS')).status).toBe(
    204,
  );
  expect((await check(true, false, local, local, dynamicOrigin, '/me')).status).toBe(401);
  expect((await check(false, false, local, local)).status).toBe(403);
  expect((await check(true, true, local, local)).status).toBe(403);
  expect((await check(true, false, 'https://runad.example', 'https://runad.example')).status).toBe(
    403,
  );
  expect((await check(true, false, local, 'http://192.168.1.10:3000')).status).toBe(403);
  expect((await check(true, false, local, local, 'https://example.com')).status).toBe(403);
  expect((await check(true, false, local, local, dynamicOrigin + '.evil')).status).toBe(403);
});
