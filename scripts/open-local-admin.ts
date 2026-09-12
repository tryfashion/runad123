import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuthStore } from '../packages/db/src/index.js';

export function validateLocalPreview(env: NodeJS.ProcessEnv) {
  if (
    env.LOCAL_PREVIEW_ENABLED !== 'true' ||
    env.NODE_ENV === 'production' ||
    env.WEB_ORIGIN !== 'http://127.0.0.1:3000' ||
    !env.AUTH_SECRET ||
    !env.MYSQL_URL ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(env.MYSQL_URL).hostname)
  )
    throw Error('LOCAL_PREVIEW_CONFIG_REQUIRED');
}
export async function openLocalAdmin(open: (url: string) => Promise<void>) {
  validateLocalPreview(process.env);
  const store = createAuthStore(process.env.MYSQL_URL!);
  const token = randomBytes(32).toString('base64url'),
    sessionId = randomUUID();
  let claimed = false;
  const server = createServer();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await store.transaction(async (tx) => {
      const now = new Date(),
        email = 'local-admin@runad123.test';
      let user = (await tx.find('users', { emailNormalized: email }))[0];
      if (user && (user.role !== 'admin' || user.status !== 'active'))
        throw Error('LOCAL_ADMIN_ACCOUNT_CONFLICT');
      if (!user) {
        user = {
          id: randomUUID(),
          emailNormalized: email,
          emailDisplay: email,
          role: 'admin',
          status: 'active',
          lastLoginAt: now,
          createdAt: now,
          updatedAt: now,
        };
        await tx.insert('users', user);
      }
      await tx.insert('sessions', {
        id: sessionId,
        tokenHash: createHash('sha256').update(token).digest(),
        kind: 'web',
        installationId: null,
        userId: user.id,
        expiresAt: new Date(now.getTime() + 3600000),
        lastSeenAt: now,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert('audits', {
        id: randomUUID(),
        adminUserId: user.id,
        action: 'admin.local_preview_login',
        targetType: 'users',
        targetId: user.id,
        beforeJson: null,
        afterJson: { localPreview: true },
        requestId: randomUUID(),
        createdAt: now,
      });
    });
    await new Promise<void>((done, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', done);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('LOCAL_BRIDGE_FAILED');
    const host = `127.0.0.1:${address.port}`,
      ticket = '/' + randomBytes(32).toString('hex');
    const received = new Promise<void>((done, reject) => {
      timer = setTimeout(() => reject(Error('LOCAL_LOGIN_TIMEOUT')), 90000);
      server.on('request', (request, response) => {
        if (
          claimed ||
          request.method !== 'GET' ||
          request.headers.host !== host ||
          request.url !== ticket
        ) {
          response.writeHead(404).end();
          return;
        }
        claimed = true;
        response
          .writeHead(302, {
            'Set-Cookie': `runad-session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600`,
            Location: 'http://127.0.0.1:3000/admin?lang=zh-Hans',
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
          })
          .end();
        clearTimeout(timer);
        done();
      });
    });
    await Promise.all([received, open(`http://${host}${ticket}`)]);
    console.log('Local admin opened. Session expires in one hour.');
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    server.close();
    if (!claimed)
      await store.transaction((tx) =>
        tx.update('sessions', { id: sessionId }, { revokedAt: new Date() }),
      );
    await store.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void openLocalAdmin(async (url) => {
    await new Promise<void>((done, reject) => {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `Start-Process '${url}'`],
        { windowsHide: true, stdio: 'ignore' },
      );
      child.once('error', reject);
      child.once('exit', (code) => (code === 0 ? done() : reject(Error('BROWSER_OPEN_FAILED'))));
    });
  }).catch(() => {
    console.error('LOCAL_ADMIN_FAILED: check local configuration and database.');
    process.exitCode = 1;
  });
}
