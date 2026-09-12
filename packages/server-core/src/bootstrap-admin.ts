import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createAuthStore } from '@runad123/db';

async function main() {
  const email = z.email().max(254).parse(process.env.ADMIN_EMAIL?.trim().toLowerCase());
  if (!process.env.MYSQL_URL) throw new Error('MYSQL_URL_REQUIRED');
  const store = createAuthStore(process.env.MYSQL_URL);
  try {
    await store.transaction(async (tx) => {
      if ((await tx.find('users', { role: 'admin' }))[0]) throw new Error('ADMIN_ALREADY_EXISTS');
      const now = new Date(),
        user = (await tx.find('users', { emailNormalized: email }))[0];
      if (user?.status === 'disabled') throw new Error('ACCOUNT_DISABLED');
      const id = user?.id ?? randomUUID();
      if (user) await tx.update('users', { id }, { role: 'admin', updatedAt: now });
      else
        await tx.insert('users', {
          id,
          emailNormalized: email,
          emailDisplay: email,
          role: 'admin',
          status: 'active',
          lastLoginAt: null,
          createdAt: now,
          updatedAt: now,
        });
      await tx.insert('audits', {
        id: randomUUID(),
        adminUserId: id,
        action: 'admin.bootstrap',
        targetType: 'users',
        targetId: id,
        beforeJson: null,
        afterJson: { role: 'admin' },
        requestId: randomUUID(),
        createdAt: now,
      });
    });
    process.stdout.write('ADMIN_BOOTSTRAPPED: sign in using email verification.\n');
  } finally {
    await store.close();
  }
}
void main().catch(() => {
  process.stderr.write(
    'ADMIN_BOOTSTRAP_FAILED: verify configuration and existing administrator.\n',
  );
  process.exitCode = 1;
});
