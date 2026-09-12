import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { accessModeSchema } from '@runad123/contracts';
import {
  consentVersion,
  installationInput,
  emailStartInput,
  emailVerifyInput,
  settingsInput,
  type PublicUser,
} from '@runad123/contracts/auth';
import type { AuthStore, AuthTransaction, Rows } from '@runad123/db';
import type { Mailer } from './mail.js';
import { digest, hmac, same, secretToken, validToken, ServiceError } from './security.js';

const DAY = 86400000;
export type Principal = {
  session: Rows['sessions'];
  user: Rows['users'] | null;
  installation: Rows['installations'] | null;
};
type Proof = { token?: string; preAuth?: string };
const publicUser = (user: Rows['users']): PublicUser => ({
  id: user.id,
  email: user.emailDisplay,
  role: user.role,
});
export class AuthService {
  constructor(
    readonly store: AuthStore,
    readonly mailer: Mailer,
    readonly secret: string,
    readonly now = () => new Date(),
  ) {
    if (secret.length < 32) throw new Error('AUTH_SECRET_REQUIRED');
  }
  private async gate(tx: AuthTransaction) {
    const row = (await tx.find('settings', { key: 'access_mode' }))[0];
    if (!row) throw new ServiceError('SERVICE_NOT_READY', 503);
    return { accessMode: accessModeSchema.parse(row.valueJson), configVersion: row.version };
  }
  async config() {
    return this.store.transaction(async (tx) => ({
      ...(await this.gate(tx)),
      consentVersion,
      supportedUiLocales: ['zh-Hans', 'zh-Hant', 'en'],
      defaultUiLocale: 'en',
      protocolVersion: 1,
    }));
  }
  async authenticate(tx: AuthTransaction, token?: string): Promise<Principal> {
    if (!validToken(token)) throw new ServiceError('SESSION_EXPIRED', 401);
    const session = (await tx.find('sessions', { tokenHash: digest(token) }))[0];
    if (!session || session.revokedAt || session.expiresAt <= this.now())
      throw new ServiceError('SESSION_EXPIRED', 401);
    const user = session.userId ? (await tx.find('users', { id: session.userId }))[0] : null;
    const installation = session.installationId
      ? (await tx.find('installations', { id: session.installationId }))[0]
      : null;
    if (
      (session.userId && (!user || user.status !== 'active')) ||
      (session.installationId && (!installation || installation.status !== 'active')) ||
      (session.kind === 'anonymous' && installation?.linkedUserId)
    )
      throw new ServiceError('SESSION_EXPIRED', 401);
    return { session, user: user ?? null, installation: installation ?? null };
  }
  async authorize(
    tx: AuthTransaction,
    token: string | undefined,
    mode: 'read' | 'core' | 'admin' = 'read',
  ) {
    const actor = await this.authenticate(tx, token);
    if (mode === 'admin' && (actor.session.kind !== 'web' || actor.user?.role !== 'admin'))
      throw new ServiceError('FORBIDDEN', 403);
    if (
      mode === 'core' &&
      (
        await tx.find('deletions', {
          principalType: actor.user ? 'user' : 'installation',
          principalId: actor.user?.id ?? actor.installation!.id,
          state: 'pending',
        })
      ).length
    )
      throw new ServiceError('DATA_DELETION_PENDING', 409);
    if (mode === 'core' && !actor.user && (await this.gate(tx)).accessMode === 'login_required')
      throw new ServiceError('LOGIN_REQUIRED', 403);
    return actor;
  }
  async me(token?: string) {
    return this.store.transaction(async (tx) => {
      const actor = await this.authorize(tx, token);
      const gate = await this.gate(tx);
      return {
        user: actor.user ? publicUser(actor.user) : null,
        installationId: actor.installation?.id ?? null,
        expiresAt: actor.session.expiresAt.toISOString(),
        loginRequired: !actor.user && gate.accessMode === 'login_required',
        quota: null,
      };
    });
  }
  // Shared owner rule for M2 drafts and M3 requests (request -> revision -> draft).
  async owns(
    tx: AuthTransaction,
    actor: Principal,
    draft: { userId: string | null; installationId: string },
  ) {
    if (draft.userId) return actor.user?.id === draft.userId;
    const installation = (await tx.find('installations', { id: draft.installationId }))[0];
    if (!installation) return false;
    if (installation.linkedUserId) return actor.user?.id === installation.linkedUserId;
    return !actor.user && actor.installation?.id === installation.id;
  }
  private async issue(
    tx: AuthTransaction,
    kind: Rows['sessions']['kind'],
    installationId: string | null,
    userId: string | null,
  ) {
    const token = secretToken(),
      now = this.now(),
      expiresAt = new Date(
        +now + (kind === 'anonymous' ? 90 : kind === 'extension' ? 30 : 7) * DAY,
      );
    await tx.insert('sessions', {
      id: randomUUID(),
      tokenHash: digest(token),
      kind,
      installationId,
      userId,
      expiresAt,
      lastSeenAt: now,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    return { token, expiresAt: expiresAt.toISOString(), installationId };
  }
  private async newInstallation(tx: AuthTransaction, version: string) {
    const id = randomUUID(),
      now = this.now();
    await tx.insert('installations', {
      id,
      status: 'active',
      consentVersion,
      consentedAt: now,
      linkedUserId: null,
      linkedAt: null,
      lastSeenAt: now,
      extensionVersion: version,
      createdAt: now,
      updatedAt: now,
    });
    return this.issue(tx, 'anonymous', id, null);
  }
  async install(input: z.infer<typeof installationInput>, ip: string) {
    installationInput.parse(input);
    await this.rate([['install:ip:' + ip, 3600, 20]]);
    return this.store.transaction((tx) => this.newInstallation(tx, input.extensionVersion));
  }
  async renew(token?: string) {
    await this.rate([['renew:' + digest(token ?? '').toString('hex'), 60, 10]]);
    return this.store.transaction(async (tx) => {
      const actor = await this.authenticate(tx, token);
      if (actor.session.kind === 'web') throw new ServiceError('FORBIDDEN', 403);
      const now = this.now();
      const expiresAt = new Date(+now + (actor.user ? 30 : 90) * DAY);
      await tx.update(
        'sessions',
        { id: actor.session.id },
        { expiresAt, lastSeenAt: now, updatedAt: now },
      );
      return { expiresAt: expiresAt.toISOString() };
    });
  }
  async rate(limits: Array<[string, number, number]>) {
    const error = await this.store.transaction(async (tx) => {
      const now = this.now();
      let retry = 0;
      for (const [key, seconds, max] of limits) {
        const start = new Date(Math.floor(+now / (seconds * 1000)) * seconds * 1000),
          expiresAt = new Date(+start + seconds * 1000);
        const where = {
          keyHash: hmac(this.secret, 'rate', key),
          windowStart: start,
          windowSeconds: seconds,
        };
        const row = (await tx.find('buckets', where))[0];
        if (row && row.count >= max) {
          retry = Math.max(retry, Math.ceil((+expiresAt - +now) / 1000));
          continue;
        }
        if (row) await tx.update('buckets', where, { count: row.count + 1, updatedAt: now });
        else
          await tx.insert('buckets', {
            ...where,
            count: 1,
            expiresAt,
            createdAt: now,
            updatedAt: now,
          });
      }
      return retry;
    });
    if (error) throw new ServiceError('RATE_LIMITED', 429, { retryAfterSeconds: error });
  }
  async start(input: z.infer<typeof emailStartInput>, proof: Proof, ip: string) {
    input = emailStartInput.parse(input);
    await this.rate([
      ['email:ip:' + ip, 3600, 30],
      ['email:email:' + input.email, 3600, 5],
    ]);
    if (this.mailer.kind === 'disabled') throw new ServiceError('EMAIL_UNAVAILABLE', 503);
    const challengeId = randomUUID(),
      code = randomInt(1000000).toString().padStart(6, '0'),
      preAuth = validToken(proof.preAuth) ? proof.preAuth : secretToken();
    const result = await this.store.transaction(async (tx) => {
      let installationId: string | null = null;
      if (input.clientKind === 'extension') {
        const actor = await this.authenticate(tx, proof.token);
        if (!actor.installation || actor.session.kind === 'web')
          throw new ServiceError('FORBIDDEN', 403);
        installationId = actor.installation.id;
      }
      const recent = await tx.find('challenges', { emailNormalized: input.email });
      const newest = recent.sort((a, b) => +b.createdAt - +a.createdAt)[0];
      if (newest && +this.now() - +newest.createdAt < 60000)
        throw new ServiceError('RATE_LIMITED', 429, {
          retryAfterSeconds: Math.ceil((60000 - (+this.now() - +newest.createdAt)) / 1000),
        });
      const now = this.now();
      await tx.insert('challenges', {
        id: challengeId,
        emailNormalized: input.email,
        installationId,
        preAuthHash: input.clientKind === 'web' ? digest(preAuth) : null,
        codeHmac: hmac(this.secret, 'code', `${challengeId}:${code}`),
        state: 'pending',
        expiresAt: new Date(+now + 600000),
        attempts: 0,
        consumedAt: null,
        clientKind: input.clientKind,
        deliveryLocale: input.deliveryLocale,
        createdAt: now,
        updatedAt: now,
      });
      return { installationId };
    });
    if (result.installationId)
      await this.rate([['email:installation:' + result.installationId, 3600, 10]]);
    try {
      await this.mailer.send({ email: input.email, code, locale: input.deliveryLocale });
    } catch {
      await this.store.transaction((tx) =>
        tx.update('challenges', { id: challengeId }, { state: 'failed', updatedAt: this.now() }),
      );
      throw new ServiceError('EMAIL_UNAVAILABLE', 503);
    }
    await this.store.transaction((tx) =>
      tx.update('challenges', { id: challengeId }, { state: 'sent', updatedAt: this.now() }),
    );
    return {
      challengeId,
      retryAfterSeconds: 60,
      preAuth: input.clientKind === 'web' ? preAuth : undefined,
    };
  }
  async verify(input: z.infer<typeof emailVerifyInput>, proof: Proof, ip: string) {
    input = emailVerifyInput.parse(input);
    await this.rate([
      ['verify:ip:' + ip, 600, 60],
      ['verify:challenge:' + input.challengeId, 600, 10],
    ]);
    const rateSubject = await this.store.transaction(
      async (tx) => (await tx.find('challenges', { id: input.challengeId }))[0],
    );
    if (rateSubject)
      await this.rate([
        ['verify:email:' + rateSubject.emailNormalized, 600, 30],
        ...(rateSubject.installationId
          ? [
              [`verify:installation:${rateSubject.installationId}`, 600, 60] as [
                string,
                number,
                number,
              ],
            ]
          : []),
      ]);
    const result = await this.store.transaction(async (tx) => {
      const challenge = (await tx.find('challenges', { id: input.challengeId }))[0];
      const invalid = () => ({ error: new ServiceError('CODE_INVALID', 422) });
      if (
        !challenge ||
        challenge.state !== 'sent' ||
        !challenge.codeHmac ||
        challenge.consumedAt ||
        challenge.expiresAt <= this.now() ||
        challenge.attempts >= 5
      )
        return invalid();
      if (
        (challenge.clientKind === 'web' && proof.token) ||
        (challenge.clientKind === 'extension' && !proof.token)
      )
        throw new ServiceError('FORBIDDEN', 403);
      let installation: Rows['installations'] | null = null;
      if (challenge.clientKind === 'extension') {
        const actor = await this.authenticate(tx, proof.token);
        if (actor.installation?.id !== challenge.installationId)
          throw new ServiceError('FORBIDDEN', 403);
        installation = actor.installation;
      } else if (
        !validToken(proof.preAuth) ||
        !challenge.preAuthHash ||
        !same(digest(proof.preAuth), challenge.preAuthHash)
      )
        throw new ServiceError('FORBIDDEN', 403);
      if (!same(hmac(this.secret, 'code', `${challenge.id}:${input.code}`), challenge.codeHmac)) {
        await tx.update(
          'challenges',
          { id: challenge.id },
          { attempts: challenge.attempts + 1, updatedAt: this.now() },
        );
        return invalid();
      }
      const now = this.now();
      let user = (await tx.find('users', { emailNormalized: challenge.emailNormalized }))[0];
      if (user?.status === 'disabled') return { error: new ServiceError('ACCOUNT_DISABLED', 403) };
      if (!user) {
        user = {
          id: randomUUID(),
          emailNormalized: challenge.emailNormalized,
          emailDisplay: challenge.emailNormalized,
          role: 'user',
          status: 'active',
          lastLoginAt: now,
          createdAt: now,
          updatedAt: now,
        };
        await tx.insert('users', user);
      }
      if (installation && input.linkInstallationHistory) {
        if (
          (
            await tx.find('deletions', {
              principalType: 'user',
              principalId: user.id,
              state: 'pending',
            })
          ).length ||
          (
            await tx.find('deletions', {
              principalType: 'installation',
              principalId: installation.id,
              state: 'pending',
            })
          ).length
        )
          throw new ServiceError('DATA_DELETION_PENDING', 409);
        if (installation.linkedUserId && installation.linkedUserId !== user.id)
          throw new ServiceError('HISTORY_ALREADY_LINKED', 409);
        await tx.update(
          'installations',
          { id: installation.id },
          { linkedUserId: user.id, linkedAt: installation.linkedAt ?? now, updatedAt: now },
        );
        await tx.update(
          'sessions',
          { installationId: installation.id, kind: 'anonymous', revokedAt: null },
          { revokedAt: now, updatedAt: now },
        );
      }
      // Consume and issue credentials atomically; a replay never returns the old token.
      await tx.update(
        'challenges',
        { id: challenge.id },
        { consumedAt: now, codeHmac: null, updatedAt: now },
      );
      await tx.update('users', { id: user.id }, { lastLoginAt: now, updatedAt: now });
      const credential = await this.issue(
        tx,
        challenge.clientKind,
        installation?.id ?? null,
        user.id,
      );
      return { credential, user: publicUser(user), clientKind: challenge.clientKind };
    });
    if ('error' in result) throw result.error;
    return result;
  }
  async logout(token?: string) {
    return this.store.transaction(async (tx) => {
      const actor = await this.authenticate(tx, token),
        now = this.now();
      await tx.update('sessions', { id: actor.session.id }, { revokedAt: now, updatedAt: now });
      if (!actor.installation) return { credential: null };
      if (actor.installation.linkedUserId)
        return { credential: await this.newInstallation(tx, actor.installation.extensionVersion) };
      // Existing anonymous token may remain in the trusted client; issue a fresh one without recovering it by ID.
      return { credential: await this.issue(tx, 'anonymous', actor.installation.id, null) };
    });
  }
  async adminSettings(token?: string) {
    return this.store.transaction(async (tx) => {
      await this.authorize(tx, token, 'admin');
      return { ...(await this.gate(tx)), emailConfigured: this.mailer.kind === 'smtp' };
    });
  }
  async changeSettings(
    input: z.infer<typeof settingsInput>,
    token: string | undefined,
    requestId: string,
  ) {
    settingsInput.parse(input);
    await this.store.transaction((tx) => this.authorize(tx, token, 'admin'));
    // An SMTP connection check is necessary but not proof of inbox delivery. Memory mail never unlocks this switch.
    if (
      input.accessMode === 'login_required' &&
      (this.mailer.kind !== 'smtp' || !(await this.mailer.verify()))
    )
      throw new ServiceError('EMAIL_UNAVAILABLE', 503);
    return this.store.transaction(async (tx) => {
      const actor = await this.authorize(tx, token, 'admin'),
        before = await this.gate(tx);
      if (before.configVersion !== input.expectedVersion)
        throw new ServiceError('SETTINGS_CONFLICT', 409);
      const now = this.now();
      await tx.update(
        'settings',
        { key: 'access_mode' },
        {
          valueJson: input.accessMode,
          version: before.configVersion + 1,
          updatedBy: actor.user!.id,
          updatedAt: now,
        },
      );
      await tx.insert('audits', {
        id: randomUUID(),
        adminUserId: actor.user!.id,
        action: 'settings.update',
        targetType: 'settings',
        targetId: 'access_mode',
        beforeJson: before,
        afterJson: { accessMode: input.accessMode },
        requestId,
        createdAt: now,
      });
      return this.gate(tx);
    });
  }
}
