import { randomUUID } from 'node:crypto';
import {
  memberRegistrationInput,
  memberLoginInput,
  memberReviewInput,
  memberListQuery,
  memberListSchema,
} from '@runad123/contracts';
import {
  AuthService,
  hashAdminPassword,
  verifyAdminPassword,
  ADMIN_PASSWORD_VERSION,
} from './auth.js';
import { digest, ServiceError } from './security.js';
export class MemberService {
  constructor(private auth: AuthService) {}
  async register(raw: unknown, ip: string, token?: string) {
    const input = memberRegistrationInput.parse(raw);
    await this.auth.rate([
      ['member-register:ip:' + ip, 3600, 5],
      ['member-register:email:' + digest(input.email).toString('hex'), 3600, 3],
      ['member-register:global', 3600, 100],
    ]);
    if (token) await this.auth.store.transaction((tx) => this.auth.authenticate(tx, token));
    const exists = await this.auth.store.transaction(
      async (tx) =>
        (await tx.find('members', { emailNormalized: input.email })).length ||
        (await tx.find('users', { emailNormalized: input.email })).length,
    );
    if (exists) return { submitted: true };
    const password = await hashAdminPassword(input.password);
    await this.auth.store.transaction(async (tx) => {
      if (
        (await tx.find('members', { emailNormalized: input.email })).length ||
        (await tx.find('users', { emailNormalized: input.email })).length
      )
        return;
      const now = this.auth.now();
      await tx.insert('members', {
        id: randomUUID(),
        emailNormalized: input.email,
        passwordSalt: password.salt,
        passwordHash: password.hash,
        passwordVersion: password.version,
        purpose: input.purpose,
        state: 'pending',
        userId: null,
        reviewerId: null,
        reviewedAt: null,
        reviewNote: '',
        createdAt: now,
        updatedAt: now,
      });
    });
    return { submitted: true };
  }
  async login(raw: unknown, kind: 'extension' | 'web', ip: string, token?: string) {
    const input = memberLoginInput.parse(raw);
    await this.auth.rate([
      ['member-login:ip:' + ip, 60, 20],
      ['member-login:email:' + digest(input.email).toString('hex'), 60, 5],
    ]);
    const candidate = await this.auth.store.transaction(async (tx) => {
      if (kind === 'extension') {
        const actor = await this.auth.authenticate(tx, token);
        if (!actor.installation || actor.session.kind === 'web')
          throw new ServiceError('FORBIDDEN', 403);
      }
      return (await tx.find('members', { emailNormalized: input.email }))[0];
    });
    // Expensive password hashing runs outside the global identity lock.
    const valid = await verifyAdminPassword(
      input.password,
      candidate?.passwordSalt ?? Buffer.alloc(16),
      candidate?.passwordHash ?? Buffer.alloc(64),
    );
    if (!candidate || candidate.passwordVersion !== ADMIN_PASSWORD_VERSION || !valid)
      throw new ServiceError('MEMBER_LOGIN_FAILED', 401);
    return this.auth.store.transaction(async (tx) => {
      const installation =
        kind === 'extension' ? (await this.auth.authenticate(tx, token)).installation : null;
      if (kind === 'extension' && !installation) throw new ServiceError('FORBIDDEN', 403);
      const member = (await tx.find('members', { id: candidate.id }))[0];
      if (
        !member ||
        !member.passwordHash.equals(candidate.passwordHash) ||
        !member.passwordSalt.equals(candidate.passwordSalt) ||
        member.passwordVersion !== candidate.passwordVersion
      )
        throw new ServiceError('MEMBER_LOGIN_FAILED', 401);
      if (member.state === 'pending') throw new ServiceError('REGISTRATION_PENDING', 403);
      if (member.state === 'rejected') throw new ServiceError('REGISTRATION_REJECTED', 403);
      const user = member.userId ? (await tx.find('users', { id: member.userId }))[0] : null;
      if (!user || user.status !== 'active' || user.role !== 'user')
        throw new ServiceError('MEMBER_LOGIN_FAILED', 401);
      const now = this.auth.now();
      const credential = await this.auth.issue(tx, kind, installation?.id ?? null, user.id);
      if (token)
        await tx.update(
          'sessions',
          { tokenHash: digest(token) },
          { revokedAt: now, updatedAt: now },
        );
      await tx.update('users', { id: user.id }, { lastLoginAt: now, updatedAt: now });
      return { credential, user: { id: user.id, email: user.emailDisplay, role: user.role } };
    });
  }
  async list(raw: unknown, token?: string) {
    const query = memberListQuery.parse(raw);
    return this.auth.store.transaction(async (tx) => {
      await this.auth.authorize(tx, token, 'admin');
      const rows = await tx.scan('members', {
        where: { state: query.state },
        after: query.cursor,
        limit: 51,
      });
      return memberListSchema.parse({
        items: rows.slice(0, 50).map((row) => ({
          id: row.id,
          email: row.emailNormalized,
          purpose: row.purpose,
          state: row.state,
          createdAt: row.createdAt.toISOString(),
          reviewedAt: row.reviewedAt?.toISOString() ?? null,
          note: row.reviewNote,
          emailVerified: false,
        })),
        nextCursor: rows.length > 50 ? rows[49]!.id : null,
      });
    });
  }
  async review(id: string, raw: unknown, token: string | undefined, requestId: string) {
    const input = memberReviewInput.parse(raw);
    return this.auth.store.transaction(async (tx) => {
      const actor = await this.auth.authorize(tx, token, 'admin');
      const member = (await tx.find('members', { id }))[0];
      if (!member) throw new ServiceError('NOT_FOUND', 404);
      if (member.state !== 'pending') throw new ServiceError('REVISION_CONFLICT', 409);
      const now = this.auth.now();
      let userId: string | null = null;
      if (input.decision === 'approved') {
        if ((await tx.find('users', { emailNormalized: member.emailNormalized })).length)
          throw new ServiceError('MEMBER_ACCOUNT_EXISTS', 409);
        userId = randomUUID();
        await tx.insert('users', {
          id: userId,
          emailNormalized: member.emailNormalized,
          emailDisplay: member.emailNormalized,
          role: 'user',
          status: 'active',
          lastLoginAt: null,
          createdAt: now,
          updatedAt: now,
        });
      }
      await tx.update(
        'members',
        { id },
        {
          state: input.decision,
          userId,
          reviewerId: actor.user!.id,
          reviewedAt: now,
          reviewNote: input.note,
          updatedAt: now,
        },
      );
      await tx.insert('audits', {
        id: randomUUID(),
        adminUserId: actor.user!.id,
        action: 'member.review',
        targetType: 'member_accounts',
        targetId: id,
        beforeJson: { state: 'pending' },
        afterJson: { state: input.decision, note: input.note },
        requestId,
        createdAt: now,
      });
      return { state: input.decision };
    });
  }
}
