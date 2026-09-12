import { ThemeLinkService } from './theme-links.js';
import { AdminService } from './admin.js';
import { ExportService } from './exports.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  installationInput,
  emailStartInput,
  emailVerifyInput,
  settingsInput,
  adminPasswordLoginInput,
} from '@runad123/contracts/auth';
import { AuthService } from './auth.js';
import { RiskService } from './risk-service.js';
import { ProductService } from './products.js';
import { hmac, validToken, secretToken, ServiceError } from './security.js';

export interface HttpOptions {
  webOrigin: string;
  extensionIds: string[];
  production: boolean;
  localPreview?: boolean;
  trustedIpHeader?: string;
}
export function createAuthHandler(service: AuthService, options: HttpOptions) {
  const exports = new ExportService(service),
    admin = new AdminService(service);
  const products = new ProductService(service),
    risks = new RiskService(service);
  async function aiServiceFor(id: string, token?: string) {
    return service.store.transaction(async (tx) => {
      const row = (await tx.find('jobRequests', { id }))[0];
      if (!row) throw new ServiceError('NOT_FOUND', 404);
      const selected = risks.forKind(row.kind);
      await selected.requestOwned(tx, id, token);
      return selected;
    });
  }
  const sessionName = options.production ? '__Host-runad-session' : 'runad-session';
  const preName = options.production ? '__Host-runad-preauth' : 'runad-preauth';
  const csrf = (token: string) => hmac(service.secret, 'csrf', token).toString('base64url');
  const cookie = (name: string, value: string, maxAge: number) =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${options.production ? '; Secure' : ''}`;
  return async function handle(request: Request): Promise<Response> {
    const requestId = randomUUID(),
      headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    const send = (data: unknown, status = 200) =>
      Response.json({ data, requestId }, { status, headers });
    try {
      const origin = request.headers.get('origin');
      const extensionOrigin =
        !!origin &&
        (options.extensionIds.some((id) => origin === `chrome-extension://${id}`) ||
          (options.localPreview === true &&
            !options.production &&
            options.webOrigin === 'http://127.0.0.1:3000' &&
            ['http://127.0.0.1:3000', 'http://localhost:3000'].includes(
              new URL(request.url).origin,
            ) &&
            (!request.headers.has('host') || request.headers.get('host') === '127.0.0.1:3000') &&
            /^chrome-extension:\/\/[a-p]{32}$/.test(origin)));
      if (origin && origin !== options.webOrigin && !extensionOrigin)
        throw new ServiceError('FORBIDDEN', 403);
      if (extensionOrigin) {
        headers.set('Access-Control-Allow-Origin', origin!);
        headers.set('Vary', 'Origin');
        headers.set('Access-Control-Expose-Headers', 'ETag');
      }
      if (request.method === 'OPTIONS') {
        if (!extensionOrigin && origin !== options.webOrigin)
          throw new ServiceError('FORBIDDEN', 403);
        headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
        headers.set(
          'Access-Control-Allow-Headers',
          'Authorization, Content-Type, X-CSRF-Token, Idempotency-Key, If-None-Match',
        );
        return new Response(null, { status: 204, headers });
      }
      const jar = new Map(
        (request.headers.get('cookie') ?? '').split(';').map((item) => {
          const index = item.indexOf('=');
          return [item.slice(0, index).trim(), item.slice(index + 1)];
        }),
      );
      const auth = request.headers.get('authorization');
      const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
      if (auth && !validToken(bearer)) throw new ServiceError('SESSION_EXPIRED', 401);
      if (
        extensionOrigin &&
        !bearer &&
        ![
          '/api/v1/config',
          '/api/v1/installations',
          '/api/v1/tutorials',
          '/api/v1/theme-link',
          '/api/v1/sourcing-sites',
        ].includes(new URL(request.url).pathname)
      )
        throw new ServiceError('SESSION_EXPIRED', 401);
      if (bearer && origin === options.webOrigin) throw new ServiceError('FORBIDDEN', 403);
      const webToken = jar.get(sessionName),
        preAuth = jar.get(preName);
      const token = bearer ?? webToken;
      const path = new URL(request.url).pathname.replace(/^\/api\/v1/, '');
      if (
        token &&
        ![
          '/tutorials',
          '/config',
          '/auth/csrf',
          '/auth/email/start',
          '/auth/email/verify',
        ].includes(path)
      )
        await service.store.transaction(async (tx) => {
          const actor = await service.authenticate(tx, token);
          if ((bearer && actor.session.kind === 'web') || (!bearer && actor.session.kind !== 'web'))
            throw new ServiceError('FORBIDDEN', 403);
        });
      const ip = options.trustedIpHeader
        ? (request.headers.get(options.trustedIpHeader) ?? 'missing-proxy').slice(0, 128)
        : 'unconfigured-proxy';
      const query = Object.fromEntries(new URL(request.url).searchParams);
      if (request.method === 'GET' && path === '/tutorials') {
        const data = await admin.tutorials(query);
        headers.set('ETag', data.etag);
        headers.set('Cache-Control', 'public, max-age=60');
        if (request.headers.get('if-none-match') === data.etag)
          return new Response(null, { status: 304, headers });
        return send(data);
      }
      if (request.method === 'GET' && path === '/theme-link')
        return send(await new ThemeLinkService(service).lookup(query));
      if (request.method === 'GET' && path === '/sourcing-sites')
        return send(await new ThemeLinkService(service).sourcingSites());
      if (request.method === 'GET' && path === '/admin/theme-links')
        return send(await new ThemeLinkService(service).config(token));
      if (request.method === 'GET' && path === '/admin/sourcing-sites')
        return send(await new ThemeLinkService(service).sourcingConfig(token));
      if (request.method === 'GET' && path === '/admin/overview')
        return send(await admin.overview(token));
      if (request.method === 'GET' && path === '/admin/products/trending')
        return send(await admin.trending(query, token));
      if (request.method === 'GET' && path === '/admin/limits')
        return send(await admin.limits(token));
      if (request.method === 'GET' && path === '/admin/admins')
        return send(await admin.adminAccounts(token));
      if (request.method === 'GET' && path === '/admin/me/account')
        return send(await admin.selfAccount(token));
      if (request.method === 'GET' && path === '/admin/permissions')
        return send(await admin.permissions(token));
      if (request.method === 'GET' && path === '/admin/tutorials')
        return send(await admin.tutorials(query, true, token));
      if (request.method === 'GET' && path === '/me/data-deletion')
        return send(await admin.deletionStatus(token));
      const adminList = /^\/admin\/(jobs|events|users|audits|installations)$/.exec(path);
      if (request.method === 'GET' && adminList)
        return send(
          await admin.list(
            adminList[1] as 'jobs' | 'events' | 'users' | 'audits' | 'installations',
            query.cursor,
            token,
          ),
        );
      if (request.method === 'GET' && path === '/config') return send(await service.config());
      if (request.method === 'GET' && path === '/auth/csrf') {
        if (bearer || extensionOrigin) throw new ServiceError('FORBIDDEN', 403);
        const proof = validToken(preAuth) ? preAuth : secretToken();
        headers.append('Set-Cookie', cookie(preName, proof, 600));
        return send({ csrfToken: csrf(webToken ?? proof) });
      }
      if (request.method === 'GET' && path === '/me') return send(await service.me(token));
      if (request.method === 'GET' && path === '/admin/settings')
        return send(await service.adminSettings(token));
      const riskMatch = /^\/ai-requests\/([a-f0-9-]{36})(?:\/(retry|cancel))?$/.exec(path);
      const riskStart = /^\/drafts\/([a-f0-9-]{36})\/(risk-checks|rewrites)$/.exec(path);
      if (riskMatch && request.method === 'GET' && !riskMatch[2]) {
        await service.rate([
          [
            'ai-poll:' +
              (await service.store.transaction(async (tx) => {
                const actor = await service.authorize(tx, token, 'read');
                return actor.installation?.id ?? actor.user!.id;
              })),
            60,
            60,
          ],
        ]);
        return send(await (await aiServiceFor(riskMatch[1]!, token)).status(riskMatch[1]!, token));
      }
      const draftMatch = /^\/drafts\/([a-f0-9-]{36})$/.exec(path);
      if (request.method === 'GET' && draftMatch)
        return send(await products.get(draftMatch[1]!, token));
      if (!['POST', 'PATCH'].includes(request.method)) throw new ServiceError('NOT_FOUND', 404);
      const isInstallation = path === '/installations';
      if (isInstallation && !extensionOrigin) throw new ServiceError('FORBIDDEN', 403);
      if (!bearer && !isInstallation) {
        const proof = webToken ?? preAuth;
        if (
          origin !== options.webOrigin ||
          !validToken(proof) ||
          request.headers.get('x-csrf-token') !== csrf(proof)
        )
          throw new ServiceError('CSRF_INVALID', 403);
      }
      const body = await readJson(request);
      if (request.method === 'PATCH' && path === '/admin/theme-links')
        return send(await new ThemeLinkService(service).save(body, token, requestId));
      if (request.method === 'PATCH' && path === '/admin/sourcing-sites')
        return send(await new ThemeLinkService(service).saveSourcing(body, token, requestId));
      if (request.method === 'PATCH' && path === '/admin/limits')
        return send(await admin.saveLimits(body, token, requestId));
      if (request.method === 'POST' && path === '/admin/admins')
        return send(await admin.createAdmin(body, token, requestId), 201);
      if (request.method === 'PATCH' && path === '/admin/me/account')
        return send(await admin.updateSelfAccount(body, token, requestId));
      const adminPassword = /^\/admin\/admins\/([a-f0-9-]{36})\/password$/.exec(path);
      if (request.method === 'PATCH' && adminPassword)
        return send(await admin.resetAdminPassword(adminPassword[1]!, body, token, requestId));
      const adminUserStatus = /^\/admin\/users\/([a-f0-9-]{36})\/status$/.exec(path);
      if (request.method === 'PATCH' && adminUserStatus)
        return send(await admin.changeUserStatus(adminUserStatus[1]!, body, token, requestId));
      const tutorialWrite = /^\/admin\/tutorials(?:\/([a-f0-9-]{36}))?$/.exec(path);
      if (
        tutorialWrite &&
        ((request.method === 'POST' && !tutorialWrite[1]) ||
          (request.method === 'PATCH' && tutorialWrite[1]))
      )
        return send(
          await admin.saveTutorial(tutorialWrite[1], body, token, requestId),
          tutorialWrite[1] ? 200 : 201,
        );
      if (request.method === 'POST' && path === '/me/delete-data') {
        z.strictObject({ confirm: z.literal(true) }).parse(body);
        return send(await admin.deleteData(token), 202);
      }

      const permitStart = /^\/drafts\/([a-f0-9-]{36})\/export-permits$/.exec(path),
        downloadEvent = /^\/export-permits\/([a-f0-9-]{36})\/events$/.exec(path);
      if (request.method === 'POST' && (permitStart || downloadEvent)) {
        const actor = await service.store.transaction((tx) => service.authorize(tx, token, 'read'));
        await service.rate([['export:' + (actor.installation?.id ?? actor.user!.id), 60, 60]]);
        if (permitStart)
          return send(
            await exports.permit(
              permitStart[1]!,
              body,
              request.headers.get('idempotency-key') ?? undefined,
              token,
            ),
            201,
          );
        return send(await exports.download(downloadEvent![1]!, body, token));
      }
      if (request.method === 'POST' && (riskStart || riskMatch)) {
        await service.rate([
          [
            'ai-action:' +
              (await service.store.transaction(async (tx) => {
                const actor = await service.authorize(tx, token, 'read');
                return actor.installation?.id ?? actor.user!.id;
              })),
            60,
            30,
          ],
        ]);
        const key = request.headers.get('idempotency-key') ?? undefined;
        if (riskStart)
          return send(
            await risks
              .forKind(riskStart[2] === 'rewrites' ? 'rewrite' : 'risk_check')
              .start(riskStart[1]!, body, key, token),
            202,
          );
        if (riskMatch?.[2] === 'retry')
          return send(
            await (await aiServiceFor(riskMatch[1]!, token)).retry(riskMatch[1]!, key, token),
            202,
          );
        if (riskMatch?.[2] === 'cancel')
          return send(
            await (await aiServiceFor(riskMatch[1]!, token)).cancel(riskMatch[1]!, token),
          );
      }

      if (path === '/captures' && request.method === 'POST') {
        if (!bearer) throw new ServiceError('FORBIDDEN', 403);
        return send(
          await products.capture(body, request.headers.get('idempotency-key') ?? undefined, token),
          201,
        );
      }
      if (draftMatch && request.method === 'PATCH')
        return send(await products.patch(draftMatch[1]!, body, token));
      if (path === '/installations' && request.method === 'POST')
        return send(await service.install(installationInput.parse(body), ip), 201);
      if (path === '/auth/admin/login' && request.method === 'POST') {
        if (bearer || extensionOrigin) throw new ServiceError('FORBIDDEN', 403);
        const result = await service.adminPasswordLogin(adminPasswordLoginInput.parse(body), ip);
        headers.append('Set-Cookie', cookie(sessionName, result.credential.token, 7 * 86400));
        headers.append('Set-Cookie', cookie(preName, '', 0));
        return send({ user: result.user, expiresAt: result.credential.expiresAt });
      }
      if (path === '/sessions/renew' && request.method === 'POST')
        return send(await service.renew(token));
      if (path === '/auth/email/start' && request.method === 'POST') {
        const input = emailStartInput.parse(body);
        if ((input.clientKind === 'extension') !== !!bearer)
          throw new ServiceError('FORBIDDEN', 403);
        const result = await service.start(input, { token: bearer, preAuth }, ip);
        if (result.preAuth) headers.append('Set-Cookie', cookie(preName, result.preAuth, 600));
        return send({
          challengeId: result.challengeId,
          retryAfterSeconds: result.retryAfterSeconds,
        });
      }
      if (path === '/auth/email/verify' && request.method === 'POST') {
        const result = await service.verify(
          emailVerifyInput.parse(body),
          { token: bearer, preAuth },
          ip,
        );
        if (result.clientKind === 'web') {
          headers.append('Set-Cookie', cookie(sessionName, result.credential.token, 7 * 86400));
          headers.append('Set-Cookie', cookie(preName, '', 0));
          return send({ user: result.user, expiresAt: result.credential.expiresAt });
        }
        return send({ ...result.credential, user: result.user });
      }
      if (path === '/auth/logout' && request.method === 'POST') {
        const result = await service.logout(token);
        if (!bearer) {
          headers.append('Set-Cookie', cookie(sessionName, '', 0));
          headers.append('Set-Cookie', cookie(preName, '', 0));
        }
        return send(result);
      }
      if (path === '/access/check' && request.method === 'POST')
        return send(
          await service.store.transaction(async (tx) => {
            await service.authorize(tx, token, 'core');
            return { allowed: true };
          }),
        );
      if (path === '/admin/settings' && request.method === 'PATCH')
        return send(await service.changeSettings(settingsInput.parse(body), token, requestId));
      throw new ServiceError('NOT_FOUND', 404);
    } catch (error) {
      const safe =
        error instanceof ServiceError
          ? error
          : error instanceof z.ZodError
            ? new ServiceError('INVALID_INPUT', 422)
            : new ServiceError('SERVICE_NOT_READY', 503);
      if (safe.details?.retryAfterSeconds)
        headers.set('Retry-After', String(safe.details.retryAfterSeconds));
      return Response.json(
        {
          error: {
            code: safe.code,
            message: safe.code,
            retryable: safe.status === 429 || safe.status >= 500,
            ...(safe.details ? { details: safe.details } : {}),
          },
          requestId,
        },
        { status: safe.status, headers },
      );
    }
  };
}
async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    throw new ServiceError('INVALID_INPUT', 422);
  const reader = request.body?.getReader();
  if (!reader) throw new ServiceError('INVALID_INPUT', 422);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) {
        await reader.cancel();
        throw new ServiceError('BODY_TOO_LARGE', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ServiceError('INVALID_INPUT', 422);
  }
}
