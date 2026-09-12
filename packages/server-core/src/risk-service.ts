import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type AuthTransaction, type Rows } from '@runad123/db';
import {
  riskStartSchema,
  riskInputSchema,
  riskResultSchema,
  riskStatusSchema,
  type RiskStatus,
} from '@runad123/contracts/risk';
import {
  rewriteStartSchema,
  rewriteInputSchema,
  rewriteStatusSchema,
  rewriteResultSchema,
  type RewriteStatus,
} from '@runad123/contracts/rewrite';
import { preparedRevisionSchema } from '@runad123/contracts/product';
import { stableJson } from '@runad123/product-core';
import { AuthService } from './auth.js';
import { digest, same, ServiceError } from './security.js';
import {
  aiConfigSchema,
  disabledAiConfig,
  checkRiskBudget,
  tokenCost,
  micros,
  costString,
  type AiConfig,
} from './deepseek.js';
type Job = Rows['jobs'];
const terminal = ['succeeded', 'failed', 'cancelled', 'blocked_auth'];
export type AiKind = 'risk_check' | 'rewrite';
type StatusFor<K extends AiKind> = K extends 'rewrite' ? RewriteStatus : RiskStatus;
export class RiskService<K extends AiKind = 'risk_check'> {
  constructor(
    readonly auth: AuthService,
    readonly kind: K = 'risk_check' as K,
  ) {}
  forKind(kind: string) {
    return new RiskService(this.auth, z.enum(['risk_check', 'rewrite']).parse(kind));
  }
  async config(tx: AuthTransaction) {
    const row = (
      await tx.find('settings', { key: this.kind === 'rewrite' ? 'ai_rewrite' : 'ai_risk' })
    )[0];
    const value = aiConfigSchema.parse(
      row?.valueJson ?? {
        ...disabledAiConfig,
        promptVersion: this.kind === 'rewrite' ? 'rewrite-v1' : 'risk-v1',
      },
    );
    if (value.promptVersion !== (this.kind === 'rewrite' ? 'rewrite-v1' : 'risk-v1'))
      throw new ServiceError('AI_UNAVAILABLE', 503);
    if (this.kind === 'rewrite') {
      const global = (await tx.find('settings', { key: 'ai_risk' }))[0];
      value.dailyBudget = aiConfigSchema.parse(global?.valueJson ?? disabledAiConfig).dailyBudget;
    }
    return value;
  }
  async counters(tx: AuthTransaction, principalType: string, principalId: string, period: Date) {
    const subjects = [
      ['global', 'all'],
      [principalType, principalId],
    ];
    const rows: Rows['usageCounters'][] = [];
    for (const [subjectType, subjectId] of subjects) {
      const where = {
        subjectType: subjectType!,
        subjectId: subjectId!,
        periodStart: period,
        periodKind: 'day',
        operation: subjectType === 'global' ? 'ai' : this.kind,
      };
      let row = (await tx.find('usageCounters', where))[0];
      if (!row) {
        row = {
          ...where,
          id: randomUUID(),
          reservedCount: 0,
          startedCount: 0,
          completedCount: 0,
          failedCount: 0,
          reservedCost: '0.000000',
          estimatedCost: '0.000000',
          unknownCostCount: 0,
          createdAt: this.auth.now(),
          updatedAt: this.auth.now(),
        };
        await tx.insert('usageCounters', row);
      }
      rows.push(row);
    }
    return rows;
  }
  async owned(tx: AuthTransaction, id: string, token?: string, write = false) {
    const actor = await this.auth.authorize(tx, token, write ? 'core' : 'read');
    const draft = (await tx.find('drafts', { id }))[0];
    if (!draft || !(await this.auth.owns(tx, actor, draft)))
      throw new ServiceError('NOT_FOUND', 404);
    if (draft.archivedAt) throw new ServiceError('RESOURCE_EXPIRED', 410);
    return { actor, draft };
  }
  async requestOwned(tx: AuthTransaction, id: string, token?: string) {
    const request = (await tx.find('jobRequests', { id }))[0];
    if (!request || request.kind !== this.kind) throw new ServiceError('NOT_FOUND', 404);
    const revision = (await tx.find('revisions', { id: request.draftRevisionId }))[0];
    if (!revision) throw new ServiceError('RESOURCE_EXPIRED', 410);
    const owned = await this.owned(tx, revision.draftId, token);
    const job = (await tx.find('jobs', { id: request.jobId }))[0];
    if (!job) throw new ServiceError('RESOURCE_EXPIRED', 410);
    return { request, revision, job, ...owned };
  }
  async status(id: string, token?: string): Promise<StatusFor<K>> {
    z.uuid().parse(id);
    return this.auth.store.transaction(async (tx) => {
      const { request, revision, job, draft, actor } = await this.requestOwned(tx, id, token);
      if (job.payloadPurgedAt || revision.payloadPurgedAt)
        throw new ServiceError('RESOURCE_EXPIRED', 410);
      const now = this.auth.now(),
        currentRevision = (
          await tx.find('revisions', { draftId: draft.id, revision: draft.currentRevision })
        )[0];
      const config = await this.config(tx);
      let state = request.state === 'cancelled' ? 'cancelled' : job.state;
      const gate = (await tx.find('settings', { key: 'access_mode' }))[0]?.valueJson;
      if (
        request.state === 'blocked_auth' ||
        (job.principalType === 'installation' &&
          gate === 'login_required' &&
          !actor.user &&
          !terminal.includes(job.state))
      )
        state = 'blocked_auth';
      const current =
        !!currentRevision &&
        (this.kind === 'rewrite'
          ? revision.revision === draft.currentRevision
          : same(revision.textHash, currentRevision.textHash)) &&
        job.model === config.model &&
        job.promptVersion === config.promptVersion &&
        job.schemaVersion === 1 &&
        (job.state !== 'succeeded' || (!!job.expiresAt && +job.expiresAt > +now));
      return (this.kind === 'rewrite' ? rewriteStatusSchema : riskStatusSchema).parse({
        ...(this.kind === 'rewrite' ? { kind: 'rewrite' } : {}),
        aiRequestId: request.id,
        state,
        progressStage:
          state === 'running'
            ? 'provider'
            : state === 'queued'
              ? 'queued'
              : state === 'retry_wait'
                ? 'retry'
                : state === 'blocked_auth'
                  ? 'blocked'
                  : 'complete',
        cacheHit: request.cacheHit,
        reportLocale: job.reportLocale,
        revision: revision.revision,
        current,
        result:
          state === 'succeeded' && job.expiresAt && +job.expiresAt > +now
            ? (this.kind === 'rewrite' ? rewriteResultSchema : riskResultSchema).parse(
                job.resultJson,
              )
            : null,
        error: job.expiresAt && +job.expiresAt <= +now ? 'RISK_CHECK_STALE' : job.errorCode,
        retryAfterMs: ['queued', 'running', 'retry_wait'].includes(state) ? 2000 : 0,
        expiresAt: job.expiresAt?.toISOString() ?? null,
      }) as StatusFor<K>;
    });
  }
  async start(
    draftId: string,
    raw: unknown,
    key: string | undefined,
    token?: string,
    retryOf?: string,
  ) {
    const rewriteOptions = this.kind === 'rewrite' ? rewriteStartSchema.parse(raw) : null;
    const input = rewriteOptions ?? riskStartSchema.parse(raw),
      action = z.uuid().parse(key);
    z.uuid().parse(draftId);
    const id = await this.auth.store.transaction(async (tx) => {
      const { actor, draft } = await this.owned(tx, draftId, token, true);
      if (!actor.installation) throw new ServiceError('FORBIDDEN', 403);
      if (draft.currentRevision !== input.revision)
        throw new ServiceError('REVISION_CONFLICT', 409);
      const revision = (await tx.find('revisions', { draftId, revision: input.revision }))[0];
      if (!revision || revision.payloadPurgedAt) throw new ServiceError('RESOURCE_EXPIRED', 410);
      const prepared = preparedRevisionSchema.parse(revision.preparedProductJson);
      const config = await this.config(tx);
      if (
        !config.enabled ||
        micros(config.dailyBudget) <= 0n ||
        micros(config.inputPerMillion) <= 0n ||
        micros(config.outputPerMillion) <= 0n
      )
        throw new ServiceError('AI_UNAVAILABLE', 503);
      if (rewriteOptions && rewriteOptions.language !== prepared.language)
        throw new ServiceError('INVALID_INPUT', 422);
      const riskInput = (this.kind === 'rewrite' ? rewriteInputSchema : riskInputSchema).parse({
        ...(rewriteOptions
          ? {
              rewriteTitle: rewriteOptions.rewriteTitle,
              rewriteDescription: rewriteOptions.rewriteDescription,
              descriptionHtml: prepared.preparedProduct.descriptionHtml,
            }
          : {}),
        title: prepared.preparedProduct.title,
        descriptionText: prepared.descriptionText,
        targetCountry: prepared.targetCountry,
        language: prepared.language,
        textHash: prepared.textHash,
        reportLocale: input.reportLocale,
      });
      try {
        checkRiskBudget(riskInput, config);
      } catch {
        throw new ServiceError('TEXT_TOO_LONG', 422);
      }
      const principalType = actor.user ? 'user' : 'installation',
        principalId = actor.user?.id ?? actor.installation.id,
        now = this.auth.now(),
        period = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const counters = await this.counters(tx, principalType, principalId, period);
      const payloadHash = digest(stableJson({ draftId, ...input, retryOf: retryOf ?? null }));
      const prior = (
        await tx.find('jobRequests', {
          installationId: actor.installation.id,
          clientActionId: action,
          kind: this.kind,
        })
      )[0];
      if (prior) {
        if (!same(prior.payloadHash, payloadHash))
          throw new ServiceError('IDEMPOTENCY_CONFLICT', 409);
        await this.requestOwned(tx, prior.id, token);
        return prior.id;
      }
      if (retryOf) {
        const old = await this.requestOwned(tx, retryOf, token);
        if (old.job.state === 'blocked_auth')
          await tx.update(
            'jobs',
            { id: old.job.id },
            { state: 'cancelled', errorCode: 'TASK_REPLACED', updatedAt: now },
          );
      }
      const cacheKey = digest(
        stableJson({
          principalType,
          principalId,
          kind: this.kind,
          input: riskInput,
          model: config.model,
          promptVersion: config.promptVersion,
          schemaVersion: 1,
        }),
      );
      const candidates = await tx.find('jobs', { cacheKey });
      const latest = candidates.sort((a, b) => b.generation - a.generation)[0];
      let job =
        latest &&
        ((['queued', 'running', 'retry_wait'].includes(latest.state) &&
          +latest.deadlineAt > +now) ||
          (latest.state === 'succeeded' && latest.expiresAt && +latest.expiresAt > +now)) &&
        !latest.payloadPurgedAt
          ? latest
          : undefined;
      if (
        !job &&
        latest &&
        ['failed', 'cancelled', 'blocked_auth'].includes(latest.state) &&
        !retryOf
      )
        throw new ServiceError('AI_RETRY_REQUIRED', 409);
      if (!job) {
        const reserved = tokenCost(config.inputTokenBudget, config.outputTokens, config) * 3n;
        const subject = counters[1]!,
          global = counters[0]!;
        if (
          subject.startedCount + subject.reservedCount >=
          (actor.user ? config.accountDaily : config.anonymousDaily)
        )
          throw new ServiceError('QUOTA_EXCEEDED', 429, {
            resetAt: new Date(+period + 86400000).toISOString(),
          });
        if (
          micros(global.reservedCost) + micros(global.estimatedCost) + reserved >
          micros(config.dailyBudget)
        )
          throw new ServiceError('DAILY_BUDGET_REACHED', 429, {
            resetAt: new Date(+period + 86400000).toISOString(),
          });
        for (const counter of counters)
          await tx.update(
            'usageCounters',
            { id: counter.id },
            {
              reservedCount: counter.reservedCount + 1,
              reservedCost: costString(micros(counter.reservedCost) + reserved),
              updatedAt: now,
            },
          );
        job = {
          id: randomUUID(),
          kind: this.kind,
          principalType,
          principalId,
          installationId: actor.installation.id,
          draftRevisionId: revision.id,
          cacheKey,
          generation: (latest?.generation ?? 0) + 1,
          state: 'queued',
          inputJson: riskInput,
          resultJson: null,
          reportLocale: input.reportLocale,
          model: config.model,
          promptVersion: config.promptVersion,
          schemaVersion: 1,
          attempts: 0,
          maxAttempts: 3,
          nextRunAt: now,
          leaseUntil: null,
          leaseToken: null,
          workerId: null,
          startedAt: null,
          finishedAt: null,
          deadlineAt: new Date(+now + 86400000),
          expiresAt: null,
          errorCode: null,
          inputTokens: null,
          outputTokens: null,
          estimatedCost: null,
          pricingVersion: config.pricingVersion,
          quotaPeriodStart: period,
          reservedCost: costString(reserved),
          configJson: config,
          settledAt: null,
          invalidResponses: 0,
          payloadPurgedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        await tx.insert('jobs', job);
      }
      const requestId = randomUUID();
      await tx.insert('jobRequests', {
        id: requestId,
        jobId: job.id,
        draftRevisionId: revision.id,
        principalType,
        principalId,
        installationId: actor.installation.id,
        clientActionId: action,
        kind: this.kind,
        state: 'active',
        payloadHash,
        cacheHit: job.state === 'succeeded',
        createdAt: now,
        updatedAt: now,
      });
      return requestId;
    });
    return this.status(id, token);
  }
  async retry(id: string, key: string | undefined, token?: string) {
    const old = await this.auth.store.transaction((tx) => this.requestOwned(tx, id, token));
    if (
      !['failed', 'cancelled', 'blocked_auth'].includes(old.job.state) &&
      !['blocked_auth', 'cancelled'].includes(old.request.state)
    )
      throw new ServiceError('AI_RETRY_NOT_ALLOWED', 409);
    return this.start(
      old.revision.draftId,
      {
        revision: old.revision.revision,
        reportLocale: old.job.reportLocale,
        ...(this.kind === 'rewrite'
          ? ((v) => ({
              rewriteTitle: v.rewriteTitle,
              rewriteDescription: v.rewriteDescription,
              language: v.language,
            }))(rewriteInputSchema.parse(old.job.inputJson))
          : {}),
      },
      key,
      token,
      id,
    );
  }
  async cancel(id: string, token?: string) {
    const old = await this.auth.store.transaction((tx) => this.requestOwned(tx, id, token));
    await this.auth.store.transaction(async (tx) => {
      const counters = await this.counters(
        tx,
        old.job.principalType,
        old.job.principalId,
        old.job.quotaPeriodStart,
      );
      const current = await this.requestOwned(tx, id, token);
      await tx.update('jobRequests', { id }, { state: 'cancelled', updatedAt: this.auth.now() });
      const active = (
        await tx.find('jobRequests', { jobId: current.job.id, state: 'active' })
      ).filter((r) => r.id !== id);
      if (!active.length && !terminal.includes(current.job.state))
        await this.finish(tx, current.job, counters, 'cancelled', 'TASK_CANCELLED');
    });
    return this.status(id, token);
  }
  async finish(
    tx: AuthTransaction,
    job: Job,
    counters: Rows['usageCounters'][],
    state: string,
    error: string | null,
    result: unknown = null,
  ) {
    if (job.settledAt) {
      await tx.update(
        'jobs',
        { id: job.id },
        { state, errorCode: error, leaseUntil: null, leaseToken: null },
      );
      return;
    }
    const attempts = await tx.find('jobAttempts', { jobId: job.id });
    let known = 0n,
      unknown = 0,
      input = 0,
      output = 0;
    const config = aiConfigSchema.parse(job.configJson),
      bound = tokenCost(config.inputTokenBudget, config.outputTokens, config);
    for (const a of attempts) {
      if (a.estimatedCost === null) unknown++;
      else known += micros(a.estimatedCost);
      input += a.inputTokens ?? 0;
      output += a.outputTokens ?? 0;
    }
    const held = bound * BigInt(unknown),
      now = this.auth.now();
    for (const c of counters)
      await tx.update(
        'usageCounters',
        { id: c.id },
        {
          reservedCount: c.reservedCount - (job.startedAt ? 0 : 1),
          completedCount: c.completedCount + (state === 'succeeded' ? 1 : 0),
          failedCount: c.failedCount + (job.startedAt && state !== 'succeeded' ? 1 : 0),
          reservedCost: costString(micros(c.reservedCost) - micros(job.reservedCost) + held),
          estimatedCost: costString(micros(c.estimatedCost) + known),
          unknownCostCount: c.unknownCostCount + unknown,
          updatedAt: now,
        },
      );
    await tx.update(
      'jobs',
      { id: job.id },
      {
        state,
        errorCode: error,
        resultJson: result,
        finishedAt: now,
        expiresAt: state === 'succeeded' ? new Date(+now + 7 * 86400000) : null,
        settledAt: now,
        leaseUntil: null,
        leaseToken: null,
        reservedCost: costString(held),
        estimatedCost: unknown ? null : costString(known),
        inputTokens: unknown ? null : input,
        outputTokens: unknown ? null : output,
        updatedAt: now,
      },
    );
    for (const a of attempts)
      if (!a.reconciledAt && a.estimatedCost !== null)
        await tx.update('jobAttempts', { id: a.id }, { reconciledAt: now });
  }
}
