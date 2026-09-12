import { randomUUID } from 'node:crypto';
import type { Rows } from '@runad123/db';
import { riskInputSchema, validateRiskOutput } from '@runad123/contracts/risk';
import {
  aiInputSchema,
  rewriteInputSchema,
  validateRewriteOutput,
} from '@runad123/contracts/rewrite';
import { prepareRewriteResult } from './rewrite-preparation.js';
import { RiskService } from './risk-service.js';
import {
  aiConfigSchema,
  tokenCost,
  micros,
  costString,
  checkRiskBudget,
  type RiskProvider,
  type ProviderOutcome,
} from './deepseek.js';
export class RiskWorker {
  constructor(
    readonly service: RiskService,
    readonly provider: RiskProvider,
    readonly workerId: string,
    readonly jitter = () => Math.random(),
  ) {}
  async tick() {
    const { auth } = this.service,
      now = auth.now();
    await auth.store.transaction(async (tx) => {
      const old = (await tx.find('heartbeats', { name: this.workerId }))[0];
      const row = {
        name: this.workerId,
        lastSeenAt: now,
        metadataJson: { stage: 'M3', processing: true },
        createdAt: old?.createdAt ?? now,
      };
      if (old) await tx.update('heartbeats', { name: this.workerId }, row);
      else await tx.insert('heartbeats', row);
    });
    const claimed = await auth.store.claimJob(this.workerId, now);
    if (!claimed) return false;
    const service = this.service.forKind(claimed.kind);
    const attempt = await auth.store.transaction(async (tx) => {
      const counters = await service.counters(
        tx,
        claimed.principalType,
        claimed.principalId,
        claimed.quotaPeriodStart,
      );
      const job = (await tx.find('jobs', { id: claimed.id }))[0]!;
      if (job.leaseToken !== claimed.leaseToken || job.state !== 'running') return null;
      const attempts = await tx.find('jobAttempts', { jobId: job.id });
      for (const a of attempts)
        if (a.state === 'started')
          await tx.update('jobAttempts', { id: a.id }, { state: 'unknown', finishedAt: now });
      if (+job.deadlineAt <= +now) {
        await service.finish(tx, job, counters, 'failed', 'TASK_EXPIRED');
        return null;
      }
      const deletion = (
        await tx.find('deletions', {
          principalType: job.principalType,
          principalId: job.principalId,
          state: 'pending',
        })
      )[0];
      const installation = (await tx.find('installations', { id: job.installationId }))[0];
      const linkedDeletion =
        job.principalType === 'installation' && installation?.linkedUserId
          ? (
              await tx.find('deletions', {
                principalType: 'user',
                principalId: installation.linkedUserId,
                state: 'pending',
              })
            )[0]
          : null;
      if (deletion || linkedDeletion) {
        await service.finish(tx, job, counters, 'cancelled', 'DATA_DELETION_PENDING');
        return null;
      }
      const config = await service.config(tx),
        install = (await tx.find('installations', { id: job.installationId }))[0],
        user =
          job.principalType === 'user'
            ? (await tx.find('users', { id: job.principalId }))[0]
            : null,
        gate = (await tx.find('settings', { key: 'access_mode' }))[0]?.valueJson;
      if (
        !install ||
        install.status !== 'active' ||
        (job.principalType === 'user' && user?.status !== 'active')
      ) {
        await service.finish(tx, job, counters, 'failed', 'ACCOUNT_DISABLED');
        return null;
      }
      if (
        job.principalType === 'installation' &&
        (gate === 'login_required' || install.linkedUserId)
      ) {
        await service.finish(tx, job, counters, 'blocked_auth', 'LOGIN_REQUIRED');
        return null;
      }
      if (
        !config.enabled ||
        config.model !== job.model ||
        config.promptVersion !== job.promptVersion
      ) {
        await service.finish(tx, job, counters, 'failed', 'AI_UNAVAILABLE');
        return null;
      }
      if (!(await tx.find('jobRequests', { jobId: job.id, state: 'active' })).length) {
        await service.finish(tx, job, counters, 'cancelled', 'TASK_CANCELLED');
        return null;
      }
      if (job.attempts >= job.maxAttempts) {
        await service.finish(tx, job, counters, 'failed', 'AI_ATTEMPTS_EXHAUSTED');
        return null;
      }
      try {
        checkRiskBudget(aiInputSchema.parse(job.inputJson), aiConfigSchema.parse(job.configJson));
      } catch {
        await service.finish(tx, job, counters, 'failed', 'TEXT_TOO_LONG');
        return null;
      }
      const row: Rows['jobAttempts'] = {
        id: randomUUID(),
        jobId: job.id,
        attemptNo: job.attempts + 1,
        leaseToken: job.leaseToken!,
        state: 'started',
        providerRequestId: null,
        startedAt: now,
        finishedAt: null,
        inputTokens: null,
        outputTokens: null,
        estimatedCost: null,
        pricingVersion: job.pricingVersion,
        reconciledAt: null,
        createdAt: now,
      };
      await tx.insert('jobAttempts', row);
      if (!job.startedAt)
        for (const c of counters)
          await tx.update(
            'usageCounters',
            { id: c.id },
            {
              reservedCount: c.reservedCount - 1,
              startedCount: c.startedCount + 1,
              updatedAt: now,
            },
          );
      await tx.update(
        'jobs',
        { id: job.id },
        { attempts: row.attemptNo, startedAt: job.startedAt ?? now, updatedAt: now },
      );
      return row;
    });
    if (!attempt) return true;
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 90000);
    const renewal = setInterval(() => {
      void auth.store
        .renewJob(claimed.id, claimed.leaseToken!, auth.now())
        .then((ok) => {
          if (!ok) controller.abort();
        })
        .catch(() => controller.abort());
    }, 30000);
    let outcome: ProviderOutcome;
    try {
      outcome = await this.provider.run(
        aiInputSchema.parse(claimed.inputJson),
        aiConfigSchema.parse(claimed.configJson),
        controller.signal,
        claimed.invalidResponses > 0,
      );
      if (outcome.output || outcome.rewrite)
        try {
          if (claimed.kind === 'rewrite') {
            validateRewriteOutput(outcome.rewrite, rewriteInputSchema.parse(claimed.inputJson));
            if (outcome.output) throw new Error('AI_INVALID_RESPONSE');
          } else {
            validateRiskOutput(outcome.output, riskInputSchema.parse(claimed.inputJson));
            if (outcome.rewrite) throw new Error('AI_INVALID_RESPONSE');
          }
        } catch {
          outcome = {
            ...outcome,
            output: undefined,
            rewrite: undefined,
            error: 'AI_INVALID_RESPONSE',
            retryable: true,
          };
        }
    } catch {
      outcome = { error: 'AI_UNAVAILABLE', retryable: true };
    } finally {
      clearTimeout(timeout);
      clearInterval(renewal);
    }
    await this.complete(claimed, attempt, outcome);
    return true;
  }
  async complete(claimed: Rows['jobs'], attempt: Rows['jobAttempts'], outcome: ProviderOutcome) {
    const { auth } = this.service;
    const service = this.service.forKind(claimed.kind);
    await auth.store.transaction(async (tx) => {
      const counters = await service.counters(
        tx,
        claimed.principalType,
        claimed.principalId,
        claimed.quotaPeriodStart,
      );
      const job = (await tx.find('jobs', { id: claimed.id }))[0],
        old = (await tx.find('jobAttempts', { id: attempt.id }))[0];
      // Personal deletion can remove both rows while the provider is in flight.
      // Preserve the conservative unknown-cost counter and never recreate deleted data.
      if (!job || !old) return;
      const now = auth.now(),
        config = aiConfigSchema.parse(job.configJson);
      if (old.reconciledAt || !['started', 'unknown'].includes(old.state)) return;
      const cost = outcome.usage
        ? tokenCost(outcome.usage.input, outcome.usage.output, config)
        : null;
      await tx.update(
        'jobAttempts',
        { id: old.id },
        {
          state:
            outcome.output || outcome.rewrite ? 'succeeded' : cost === null ? 'unknown' : 'failed',
          providerRequestId: outcome.providerRequestId ?? null,
          finishedAt: now,
          inputTokens: outcome.usage?.input ?? null,
          outputTokens: outcome.usage?.output ?? null,
          estimatedCost: cost === null ? null : costString(cost),
        },
      );
      if (job.settledAt) {
        if (old.estimatedCost === null && cost !== null) {
          const bound = tokenCost(config.inputTokenBudget, config.outputTokens, config);
          for (const c of counters)
            await tx.update(
              'usageCounters',
              { id: c.id },
              {
                reservedCost: costString(micros(c.reservedCost) - bound),
                estimatedCost: costString(micros(c.estimatedCost) + cost),
                unknownCostCount: c.unknownCostCount - 1,
                updatedAt: now,
              },
            );
          const all = await tx.find('jobAttempts', { jobId: job.id });
          const remaining = all.some((a) => a.estimatedCost === null);
          await tx.update(
            'jobs',
            { id: job.id },
            {
              reservedCost: costString(micros(job.reservedCost) - bound),
              estimatedCost: remaining
                ? null
                : costString(all.reduce((sum, a) => sum + micros(a.estimatedCost ?? '0'), 0n)),
              inputTokens: remaining ? null : all.reduce((sum, a) => sum + (a.inputTokens ?? 0), 0),
              outputTokens: remaining
                ? null
                : all.reduce((sum, a) => sum + (a.outputTokens ?? 0), 0),
            },
          );
          await tx.update('jobAttempts', { id: old.id }, { reconciledAt: now });
        }
        return;
      }
      if (
        job.leaseToken !== claimed.leaseToken ||
        job.state !== 'running' ||
        !job.leaseUntil ||
        +job.leaseUntil <= +now
      )
        return;
      if (+job.deadlineAt <= +now) {
        await service.finish(tx, job, counters, 'failed', 'TASK_EXPIRED');
        return;
      }
      if (outcome.rewrite) {
        try {
          const result = await prepareRewriteResult(tx, job, outcome.rewrite, now);
          await service.finish(tx, job, counters, 'succeeded', null, result);
        } catch (error) {
          await service.finish(
            tx,
            job,
            counters,
            'failed',
            error instanceof Error && error.message === 'RESOURCE_EXPIRED'
              ? 'RESOURCE_EXPIRED'
              : 'AI_INVALID_RESPONSE',
          );
        }
        return;
      }
      if (outcome.output) {
        const input = aiInputSchema.parse(job.inputJson);
        await service.finish(tx, job, counters, 'succeeded', null, {
          output: outcome.output,
          model: job.model,
          checkedAt: now.toISOString(),
          textHash: input.textHash,
          reportLocale: input.reportLocale,
          promptVersion: job.promptVersion,
          schemaVersion: 1,
          scope: 'title_description_only',
        });
        return;
      }
      const invalid = job.invalidResponses + (outcome.error === 'AI_INVALID_RESPONSE' ? 1 : 0);
      if (outcome.retryable && job.attempts < job.maxAttempts && invalid < 2) {
        await tx.update(
          'jobs',
          { id: job.id },
          {
            state: 'retry_wait',
            errorCode: outcome.error ?? 'AI_UNAVAILABLE',
            invalidResponses: invalid,
            nextRunAt: new Date(
              +now + Math.min(30000, 2000 * 2 ** job.attempts) + Math.floor(this.jitter() * 1000),
            ),
            leaseUntil: null,
            leaseToken: null,
            updatedAt: now,
          },
        );
      } else await service.finish(tx, job, counters, 'failed', outcome.error ?? 'AI_UNAVAILABLE');
    });
  }
}
