import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createAuthStore } from '@runad123/db';
import { ADMIN_PASSWORD_VERSION, hashAdminPassword } from './auth.js';

async function main() {
  const email = z.email().max(254).parse(process.env.ADMIN_EMAIL?.trim().toLowerCase());
  const password = z.string().min(8).max(256).parse(process.env.ADMIN_PASSWORD);
  if (!process.env.MYSQL_URL) throw new Error('MYSQL_URL_REQUIRED');
  const store = createAuthStore(process.env.MYSQL_URL);
  const passwordRecord = await hashAdminPassword(password);
  try {
    await store.transaction(async (tx) => {
      const now = new Date();
      const existingAdmins = await tx.find('users', { role: 'admin' });
      let user = (await tx.find('users', { emailNormalized: email }))[0];
      if (existingAdmins.length && !existingAdmins.some((admin) => admin.emailNormalized === email))
        throw new Error('ADMIN_ALREADY_EXISTS');
      if (user?.status === 'disabled') throw new Error('ACCOUNT_DISABLED');
      const id = user?.id ?? randomUUID();
      const before = user ? { role: user.role, hasPassword: true } : null;
      if (user) {
        await tx.update('users', { id }, { role: 'admin', updatedAt: now });
      } else {
        user = {
          id,
          emailNormalized: email,
          emailDisplay: email,
          role: 'admin',
          status: 'active',
          lastLoginAt: null,
          createdAt: now,
          updatedAt: now,
        };
        await tx.insert('users', user);
      }
      const byLogin = (await tx.find('adminCredentials', { loginNormalized: email }))[0];
      if (byLogin && byLogin.userId !== id) throw new Error('ADMIN_LOGIN_ALREADY_BOUND');
      const credential = (await tx.find('adminCredentials', { userId: id }))[0];
      const row = {
        userId: id,
        loginNormalized: email,
        passwordSalt: passwordRecord.salt,
        passwordHash: passwordRecord.hash,
        passwordVersion: ADMIN_PASSWORD_VERSION,
        createdAt: credential?.createdAt ?? now,
        updatedAt: now,
      };
      if (credential) await tx.update('adminCredentials', { userId: id }, row);
      else await tx.insert('adminCredentials', row);
      await tx.insert('audits', {
        id: randomUUID(),
        adminUserId: id,
        action: 'admin.bootstrap',
        targetType: 'users',
        targetId: id,
        beforeJson: before,
        afterJson: { role: 'admin', login: email, passwordVersion: ADMIN_PASSWORD_VERSION },
        requestId: randomUUID(),
        createdAt: now,
      });
    });
    process.stdout.write(
      'ADMIN_BOOTSTRAPPED: sign in at /admin/login with ADMIN_EMAIL and ADMIN_PASSWORD.\n',
    );
  } finally {
    await store.close();
  }
}
void main().catch(() => {
  process.stderr.write(
    'ADMIN_BOOTSTRAP_FAILED: verify MYSQL_URL, ADMIN_EMAIL, ADMIN_PASSWORD and existing administrator.\n',
  );
  process.exitCode = 1;
});
