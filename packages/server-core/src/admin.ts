import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  tutorialInputSchema,
  tutorialSchema,
  tutorialQuerySchema,
  limitsInputSchema,
  trendQuerySchema,
} from '@runad123/contracts/admin';
import { AuthService } from './auth.js';
import { RiskService } from './risk-service.js';
import { aiConfigSchema, disabledAiConfig } from './deepseek.js';
import { digest, ServiceError } from './security.js';
import type { AuthTransaction, Rows } from '@runad123/db';
function decodeCursor(value: string) {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString());
  } catch {
    throw new ServiceError('INVALID_INPUT', 400);
  }
}
const count = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const trendRow = z.object({
  productId: z.uuid(),
  handle: z.string(),
  url: z.url(),
  captureCount: count,
  exportCount: count,
  captureActors: count,
  exportActors: count,
  anonymousCaptureActors: count,
  accountCaptureActors: count,
  anonymousExportActors: count,
  accountExportActors: count,
});
const cursorSchema = z.object({
  at: z.iso.datetime(),
  offset: z.number().int().min(0).max(100000),
  window: z.string(),
  metric: z.string(),
});
export class AdminService {
  constructor(readonly auth: AuthService) {}
  async admin(token?: string) {
    return this.auth.store.transaction((tx) => this.auth.authorize(tx, token, 'admin'));
  }
  async hosts(tx: AuthTransaction) {
    const row = (await tx.find('settings', { key: 'admin_limits' }))[0];
    return z
      .object({ allowedTutorialHosts: z.array(z.string()).default([]) })
      .parse(row?.valueJson ?? {}).allowedTutorialHosts;
  }
  validUrl(raw: string, hosts: string[]) {
    const u = new URL(raw);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.port &&
      hosts.includes(u.hostname) &&
      !u.hash
    );
  }
  async tutorials(raw: unknown, admin = false, token?: string) {
    const query = tutorialQuerySchema.parse(raw);
    return this.auth.store.transaction(async (tx) => {
      if (admin) await this.auth.authorize(tx, token, 'admin');
      const hosts = await this.hosts(tx);
      const all = await tx.scan('tutorials', { limit: 100 });
      const rows = all
        .filter(
          (r) =>
            (admin || (r.enabled && this.validUrl(r.url, hosts))) &&
            (admin || r.placement === 'both' || r.placement === query.placement) &&
            (!query.category || r.category === query.category),
        )
        .sort(
          (a, b) =>
            Number(b.contentLocale === query.locale) - Number(a.contentLocale === query.locale) ||
            a.sortOrder - b.sortOrder ||
            a.id.localeCompare(b.id),
        );
      const etag =
        '"' +
        digest(JSON.stringify({ query: { ...query, cursor: undefined }, rows })).toString('hex') +
        '"';
      let offset = 0;
      if (query.cursor) {
        const c = z
          .object({ offset: z.number().int().min(0).max(100), etag: z.string() })
          .parse(decodeCursor(query.cursor));
        if (c.etag !== etag) throw new ServiceError('LIST_CHANGED', 409);
        offset = c.offset;
      }
      return {
        items: rows.slice(offset, offset + 20).map((r) => tutorialSchema.parse(r)),
        nextCursor:
          offset + 20 < rows.length
            ? Buffer.from(JSON.stringify({ offset: offset + 20, etag })).toString('base64url')
            : null,
        etag: '"' + digest(etag + '|' + offset).toString('hex') + '"',
      };
    });
  }
  async saveTutorial(
    id: string | undefined,
    raw: unknown,
    token: string | undefined,
    requestId: string,
  ) {
    const schema = tutorialInputSchema.extend({
        expectedVersion: z.number().int().positive().optional(),
      }),
      input = schema.parse(raw);
    return this.auth.store.transaction(async (tx) => {
      const actor = await this.auth.authorize(tx, token, 'admin');
      if (input.enabled && !this.validUrl(input.url, await this.hosts(tx)))
        throw new ServiceError('TUTORIAL_URL_INVALID', 422);
      const now = this.auth.now(),
        prior = id ? (await tx.find('tutorials', { id: z.uuid().parse(id) }))[0] : null;
      if (id && !prior) throw new ServiceError('NOT_FOUND', 404);
      if (prior && prior.version !== input.expectedVersion)
        throw new ServiceError('REVISION_CONFLICT', 409);
      if (!prior && (await tx.scan('tutorials', { limit: 100 })).length >= 100)
        throw new ServiceError('TUTORIAL_LIMIT_REACHED', 422);
      const { expectedVersion, ...fields } = input;
      const row = {
        ...tutorialInputSchema.parse(fields),
        id: prior?.id ?? randomUUID(),
        version: (prior?.version ?? 0) + 1,
        createdAt: prior?.createdAt ?? now,
        updatedAt: now,
      };
      if (prior) await tx.update('tutorials', { id: prior.id }, row);
      else await tx.insert('tutorials', row);
      await this.audit(
        tx,
        actor.user!.id,
        'tutorial.save',
        'tutorial',
        row.id,
        prior ? { version: prior.version, enabled: prior.enabled } : null,
        { version: row.version, enabled: row.enabled },
        requestId,
      );
      return tutorialSchema.parse(row);
    });
  }
  async audit(
    tx: AuthTransaction,
    userId: string,
    action: string,
    targetType: string,
    targetId: string,
    before: unknown,
    after: unknown,
    requestId: string,
  ) {
    await tx.insert('audits', {
      id: randomUUID(),
      adminUserId: userId,
      action,
      targetType,
      targetId,
      beforeJson: before,
      afterJson: after,
      requestId,
      createdAt: this.auth.now(),
    });
  }
  async limits(token?: string) {
    return this.auth.store.transaction(async (tx) => {
      await this.auth.authorize(tx, token, 'admin');
      const version = (await tx.find('settings', { key: 'admin_limits' }))[0]?.version ?? 1,
        risk = await new RiskService(this.auth).config(tx),
        rewrite = await new RiskService(this.auth, 'rewrite').config(tx);
      return {
        expectedVersion: version,
        dailyBudget: risk.dailyBudget,
        riskAnonymous: risk.anonymousDaily,
        riskAccount: risk.accountDaily,
        rewriteAnonymous: rewrite.anonymousDaily,
        rewriteAccount: rewrite.accountDaily,
        allowedTutorialHosts: await this.hosts(tx),
        riskEnabled: risk.enabled,
        rewriteEnabled: rewrite.enabled,
      };
    });
  }
  async saveLimits(raw: unknown, token: string | undefined, requestId: string) {
    const input = limitsInputSchema.parse(raw);
    await this.auth.store.transaction(async (tx) => {
      const actor = await this.auth.authorize(tx, token, 'admin'),
        row = (await tx.find('settings', { key: 'admin_limits' }))[0];
      if (!row || row.version !== input.expectedVersion)
        throw new ServiceError('REVISION_CONFLICT', 409);
      const now = this.auth.now();
      for (const kind of ['risk', 'rewrite'] as const) {
        const key = 'ai_' + kind,
          r = (await tx.find('settings', { key }))[0];
        if (!r) throw new ServiceError('SERVICE_NOT_READY', 503);
        const config = aiConfigSchema.parse(r.valueJson);
        await tx.update(
          'settings',
          { key },
          {
            valueJson: {
              ...config,
              ...(kind === 'risk'
                ? {
                    dailyBudget: input.dailyBudget,
                    anonymousDaily: input.riskAnonymous,
                    accountDaily: input.riskAccount,
                  }
                : { anonymousDaily: input.rewriteAnonymous, accountDaily: input.rewriteAccount }),
            },
            version: r.version + 1,
            updatedBy: actor.user!.id,
            updatedAt: now,
          },
        );
      }
      await tx.update(
        'settings',
        { key: 'admin_limits' },
        {
          valueJson: { allowedTutorialHosts: [...new Set(input.allowedTutorialHosts)] },
          version: row.version + 1,
          updatedBy: actor.user!.id,
          updatedAt: now,
        },
      );
      await this.audit(
        tx,
        actor.user!.id,
        'limits.save',
        'settings',
        'admin_limits',
        null,
        input,
        requestId,
      );
    });
    return this.limits(token);
  }
  async trending(raw: unknown, token?: string) {
    await this.admin(token);
    const query = trendQuerySchema.parse(raw);
    let at = this.auth.now(),
      offset = 0;
    if (query.cursor) {
      const c = cursorSchema.parse(decodeCursor(query.cursor));
      if (
        c.window !== query.window ||
        c.metric !== query.metric ||
        Date.parse(c.at) > +at ||
        +at - Date.parse(c.at) > 3600000
      )
        throw new ServiceError('LIST_CHANGED', 409);
      at = new Date(c.at);
      offset = c.offset;
    }
    const from = new Date(+at - { '24h': 1, '7d': 7, '30d': 30 }[query.window] * 86400000),
      rows = await this.auth.store.trends({
        from,
        to: at,
        metric: query.metric,
        offset,
        limit: 21,
      });
    return {
      from: from.toISOString(),
      to: at.toISOString(),
      metric: query.metric,
      items: rows.slice(0, 20).map((r) => ({
        ...trendRow.parse(r),
        sampleInsufficient:
          Number(r[query.metric === 'export' ? 'exportActors' : 'captureActors']) < 5,
      })),
      nextCursor:
        rows.length > 20
          ? Buffer.from(
              JSON.stringify({
                at: at.toISOString(),
                offset: offset + 20,
                ...query,
                cursor: undefined,
              }),
            ).toString('base64url')
          : null,
    };
  }
  async overview(token?: string) {
    await this.admin(token);
    const now = this.auth.now(),
      from = new Date(+now - 7 * 86400000);
    const raw = await this.auth.store.overview(from, now);
    const counts = z
      .object({
        totalJobs: count,
        totalAttempts: count,
        users: count,
        installations: count,
        captures: count,
        downloads: count,
        failedJobs: count,
        unknownAttempts: count,
        retries: count,
        knownCost: z.string().nullable(),
        daily: z
          .array(z.object({ day: z.string(), captureCount: count, exportCount: count }))
          .default([]),
      })
      .parse(raw);
    return this.auth.store.transaction(async (tx) => {
      await this.auth.authorize(tx, token, 'admin');
      const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
        usage = (
          await tx.find('usageCounters', {
            subjectType: 'global',
            subjectId: 'all',
            operation: 'ai',
            periodStart: today,
            periodKind: 'day',
          })
        )[0];
      const cfg = aiConfigSchema.parse(
        (await tx.find('settings', { key: 'ai_risk' }))[0]?.valueJson ?? disabledAiConfig,
      );
      return {
        ...counts,
        failureRate: counts.totalJobs ? counts.failedJobs / counts.totalJobs : null,
        unknownCostRatio: counts.totalAttempts
          ? counts.unknownAttempts / counts.totalAttempts
          : null,
        from: from.toISOString(),
        to: now.toISOString(),
        dailyBudget: cfg.dailyBudget,
        reservedCost: usage?.reservedCost ?? '0.000000',
        unknownCostCount: usage?.unknownCostCount ?? 0,
        knownCost: cfg.pricingVersion === 'unconfigured' ? null : counts.knownCost,
        heartbeats: (await tx.scan('heartbeats', { limit: 20 })).map((h) => ({
          name: h.name,
          lastSeenAt: h.lastSeenAt.toISOString(),
          stale: +now - +h.lastSeenAt > 120000,
        })),
        daily: counts.daily,
      };
    });
  }
  async list(
    kind: 'jobs' | 'events' | 'users' | 'audits' | 'installations',
    cursor: string | undefined,
    token?: string,
  ) {
    return this.auth.store.transaction(async (tx) => {
      await this.auth.authorize(tx, token, 'admin');
      if (cursor) z.uuid().parse(cursor);
      const rows = await tx.scan(kind, { after: cursor, limit: 21 });
      const items = rows.slice(0, 20).map((row) => {
        if (kind === 'jobs') {
          const r = row as Rows['jobs'];
          return {
            id: r.id,
            kind: r.kind,
            state: r.state,
            errorCode: r.errorCode,
            attempts: r.attempts,
            estimatedCost: r.estimatedCost,
            createdAt: r.createdAt.toISOString(),
          };
        }
        if (kind === 'events') {
          const r = row as Rows['events'];
          return {
            id: r.id,
            type: r.eventType,
            productId: r.productId,
            actorKind: r.userIdAtEvent ? 'account' : 'anonymous',
            receivedAt: r.receivedAt.toISOString(),
          };
        }
        if (kind === 'users') {
          const r = row as Rows['users'];
          return {
            id: r.id,
            email: r.emailDisplay,
            role: r.role,
            status: r.status,
            createdAt: r.createdAt.toISOString(),
          };
        }
        if (kind === 'installations') {
          const r = row as Rows['installations'];
          return {
            id: r.id,
            status: r.status,
            linked: !!r.linkedUserId,
            lastSeenAt: r.lastSeenAt.toISOString(),
          };
        }
        const r = row as Rows['audits'];
        return {
          id: r.id,
          action: r.action,
          targetType: r.targetType,
          targetId: r.targetId,
          createdAt: r.createdAt.toISOString(),
        };
      });
      return { items, nextCursor: rows.length > 20 ? rows[19]!.id : null };
    });
  }
  async deleteData(token?: string) {
    return this.auth.store.transaction(async (tx) => {
      const actor = await this.auth.authorize(tx, token, 'read'),
        principalType = actor.user ? 'user' : 'installation',
        principalId = actor.user?.id ?? actor.installation!.id;
      const prior = (
        await tx.find('deletions', { principalType, principalId, state: 'pending' })
      )[0];
      if (prior) return { id: prior.id, state: prior.state };
      const now = this.auth.now(),
        row: Rows['deletions'] = {
          id: randomUUID(),
          principalType,
          principalId,
          state: 'pending',
          phase: 'cancel_jobs',
          cursor: null,
          createdAt: now,
          updatedAt: now,
        };
      await tx.insert('deletions', row);
      return { id: row.id, state: row.state };
    });
  }
  async deletionStatus(token?: string) {
    return this.auth.store.transaction(async (tx) => {
      const actor = await this.auth.authorize(tx, token, 'read');
      const rows = await tx.find('deletions', {
        principalType: actor.user ? 'user' : 'installation',
        principalId: actor.user?.id ?? actor.installation!.id,
      });
      return rows.slice(0, 1).map((r) => ({ id: r.id, state: r.state }));
    });
  }
}
