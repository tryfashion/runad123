import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthTransaction, Rows, TableName } from '@runad123/db';
import { AuthService } from './auth.js';
import { RiskService } from './risk-service.js';
const day = 86400000,
  terminal = ['succeeded', 'failed', 'cancelled', 'blocked_auth'];
const personalPhases = [
  'cancel_jobs',
  'events',
  'permits',
  'jobRequests',
  'jobAttempts',
  'jobs',
  'revisions',
  'drafts',
  'captures',
  'stats_reset',
  'linked_installations',
] as const;
const phases = [
  'expire_jobs',
  'payload_jobs',
  'payload_revisions',
  'events',
  'permits',
  'jobRequests',
  'jobAttempts',
  'jobs',
  'revisions',
  'drafts',
  'captures',
  'snapshots',
  'sourceProducts',
  'sourceStores',
  'buckets',
  'challenges',
  'sessions',
  'audits',
  'dailyStats',
  'deletions',
  'usageCounters',
] as const;
const checkpointSchema = z.object({
  phase: z.number().int().nonnegative(),
  cursor: z.string().nullable(),
});
export class MaintenanceService {
  constructor(readonly auth: AuthService) {}
  async ownedPrincipal(tx: AuthTransaction, type: string, id: string, deletion: Rows['deletions']) {
    if (type === deletion.principalType && id === deletion.principalId) return true;
    if (type !== 'installation' || deletion.principalType !== 'user') return false;
    return (await tx.find('installations', { id }))[0]?.linkedUserId === deletion.principalId;
  }
  async owned(
    tx: AuthTransaction,
    table: TableName,
    row: Rows[TableName],
    deletion: Rows['deletions'],
  ): Promise<boolean> {
    if (table === 'jobs' || table === 'jobRequests' || table === 'permits') {
      const r = row as Rows['jobs'];
      return this.ownedPrincipal(tx, r.principalType, r.principalId, deletion);
    }
    if (table === 'jobAttempts') {
      const r = row as Rows['jobAttempts'],
        job = (await tx.find('jobs', { id: r.jobId }))[0];
      return !!job && this.owned(tx, 'jobs', job, deletion);
    }
    if (table === 'revisions') {
      const r = row as Rows['revisions'],
        draft = (await tx.find('drafts', { id: r.draftId }))[0];
      return !!draft && this.owned(tx, 'drafts', draft, deletion);
    }
    if (table === 'drafts') {
      const r = row as Rows['drafts'];
      return this.ownedPrincipal(
        tx,
        r.userId ? 'user' : 'installation',
        r.userId ?? r.installationId,
        deletion,
      );
    }
    if (table === 'captures') {
      const r = row as Rows['captures'];
      return this.ownedPrincipal(
        tx,
        r.userIdAtCapture ? 'user' : 'installation',
        r.userIdAtCapture ?? r.installationId,
        deletion,
      );
    }
    if (table === 'events') {
      const r = row as Rows['events'];
      return this.ownedPrincipal(
        tx,
        r.userIdAtEvent ? 'user' : 'installation',
        r.userIdAtEvent ?? r.installationId,
        deletion,
      );
    }
    return false;
  }
  async cancel(tx: AuthTransaction, job: Rows['jobs'], code: string) {
    if (!terminal.includes(job.state) || job.state === 'blocked_auth') {
      const service = new RiskService(this.auth).forKind(job.kind),
        counters = await service.counters(
          tx,
          job.principalType,
          job.principalId,
          job.quotaPeriodStart,
        );
      await service.finish(tx, job, counters, 'cancelled', code);
    }
  }
  async orphanSnapshot(tx: AuthTransaction, id: string) {
    if ((await tx.find('captures', { snapshotId: id })).length) return;
    const snapshot = (await tx.find('snapshots', { id }))[0];
    if (!snapshot) return;
    await tx.update(
      'sourceProducts',
      { latestSnapshotId: id },
      { latestSnapshotId: null, updatedAt: this.auth.now() },
    );
    await tx.delete('snapshots', { id });
  }
  async personalBatch() {
    return this.auth.store.transaction(async (tx) => {
      const deletion = (await tx.find('deletions', { state: 'pending' }))[0];
      if (!deletion) return false;
      const phase = personalPhases.includes(deletion.phase as (typeof personalPhases)[number])
        ? (deletion.phase as (typeof personalPhases)[number])
        : 'cancel_jobs';
      const table: TableName =
        phase === 'cancel_jobs'
          ? 'jobs'
          : phase === 'linked_installations'
            ? 'installations'
            : phase === 'stats_reset'
              ? 'dailyStats'
              : phase;
      const rows = await tx.scan(table, { after: deletion.cursor ?? undefined, limit: 25 });
      for (const row of rows) {
        if (phase === 'linked_installations') {
          const r = row as Rows['installations'];
          if (deletion.principalType === 'user' && r.linkedUserId === deletion.principalId)
            await tx.update(
              'installations',
              { id: r.id },
              { linkedUserId: null, linkedAt: null, updatedAt: this.auth.now() },
            );
          continue;
        }
        if (phase === 'stats_reset') {
          const r = row as Rows['dailyStats'];
          if (+r.dayUtc >= +this.auth.now() - 90 * day) await tx.delete('dailyStats', { id: r.id });
          continue;
        }
        if (!(await this.owned(tx, table, row, deletion))) continue;
        if (phase === 'cancel_jobs') {
          await this.cancel(tx, row as Rows['jobs'], 'DATA_DELETION_PENDING');
          continue;
        }
        const id = (row as { id: string }).id;
        await tx.delete(table, { id } as never);
        if (phase === 'captures')
          await this.orphanSnapshot(tx, (row as Rows['captures']).snapshotId);
      }
      if (rows.length === 25) {
        await tx.update(
          'deletions',
          { id: deletion.id },
          { cursor: (rows.at(-1) as { id: string }).id, updatedAt: this.auth.now() },
        );
      } else {
        const next = personalPhases.indexOf(phase) + 1;
        await tx.update(
          'deletions',
          { id: deletion.id },
          {
            phase: personalPhases[next] ?? 'done',
            cursor: null,
            state: next === personalPhases.length ? 'complete' : 'pending',
            updatedAt: this.auth.now(),
          },
        );
        if (next === personalPhases.length) {
          const existing = (await tx.find('heartbeats', { name: 'daily-rollup' }))[0];
          if (existing)
            await tx.update(
              'heartbeats',
              { name: 'daily-rollup' },
              {
                metadataJson: {
                  day: new Date(+this.auth.now() - 89 * day).toISOString().slice(0, 10),
                  offset: 0,
                  clearing: true,
                },
                lastSeenAt: this.auth.now(),
              },
            );
        }
      }
      return true;
    });
  }
  async retentionBatch() {
    return this.auth.store.transaction(async (tx) => {
      const existing = (await tx.find('heartbeats', { name: 'retention' }))[0],
        state = checkpointSchema.catch({ phase: 0, cursor: null }).parse(existing?.metadataJson),
        phase = phases[state.phase % phases.length]!,
        table: TableName =
          phase === 'expire_jobs' || phase === 'payload_jobs'
            ? 'jobs'
            : phase === 'payload_revisions'
              ? 'revisions'
              : phase;
      const policy = z
        .object({
          payloadDays: z.number().int().min(1).max(30),
          eventDays: z.number().int().min(1).max(90),
          aggregateDays: z.number().int().min(1).max(365),
          auditDays: z.number().int().min(1).max(180),
        })
        .parse(
          (await tx.find('settings', { key: 'retention' }))[0]?.valueJson ?? {
            payloadDays: 30,
            eventDays: 90,
            aggregateDays: 365,
            auditDays: 180,
          },
        );
      const now = this.auth.now(),
        days = phase.startsWith('payload')
          ? policy.payloadDays
          : phase === 'expire_jobs'
            ? 0
            : phase === 'buckets'
              ? 0
              : phase === 'challenges'
                ? 1
                : phase === 'sessions'
                  ? 30
                  : phase === 'audits'
                    ? policy.auditDays
                    : phase === 'dailyStats'
                      ? policy.aggregateDays
                      : policy.eventDays;
      const cutoff = new Date(+now - days * day);
      const rows = await tx.scan(table, {
        ...(table === 'buckets' ? {} : { after: state.cursor ?? undefined }),
        before: {
          field: (table === 'buckets' || table === 'challenges'
            ? 'expiresAt'
            : table === 'dailyStats'
              ? 'dayUtc'
              : table === 'sourceProducts' || table === 'sourceStores'
                ? 'lastSeenAt'
                : 'createdAt') as never,
          value: cutoff,
        },
        limit: 25,
      });
      for (const row of rows) {
        const id = (row as { id: string }).id;
        if (phase === 'expire_jobs') {
          const r = row as Rows['jobs'];
          if (!terminal.includes(r.state) && +r.deadlineAt < +now)
            await this.cancel(tx, r, 'TASK_EXPIRED');
          continue;
        }
        if (phase === 'payload_jobs') {
          const r = row as Rows['jobs'];
          if (terminal.includes(r.state) && !r.payloadPurgedAt)
            await tx.update(
              'jobs',
              { id },
              { inputJson: null, resultJson: null, payloadPurgedAt: now, updatedAt: now },
            );
          continue;
        }
        if (phase === 'payload_revisions') {
          const r = row as Rows['revisions'];
          if (
            !(await tx.find('jobs', { draftRevisionId: id })).some(
              (j) => !terminal.includes(j.state),
            )
          )
            await tx.update(
              'revisions',
              { id },
              {
                preparedProductJson: null,
                exportSettingsJson: null,
                payloadPurgedAt: r.payloadPurgedAt ?? now,
              },
            );
          continue;
        }
        if (table === 'permits' && (await tx.find('events', { exportPermitId: id })).length)
          continue;
        if (table === 'jobRequests' && (await tx.find('permits', { riskRequestId: id })).length)
          continue;
        if (table === 'jobAttempts') {
          const r = row as Rows['jobAttempts'],
            job = (await tx.find('jobs', { id: r.jobId }))[0];
          if (job && !terminal.includes(job.state)) continue;
        }
        if (table === 'jobs') {
          const r = row as Rows['jobs'];
          if (
            !terminal.includes(r.state) ||
            (await tx.find('jobRequests', { jobId: id })).length ||
            (await tx.find('jobAttempts', { jobId: id })).length
          )
            continue;
        }
        if (
          table === 'revisions' &&
          ((await tx.find('jobs', { draftRevisionId: id })).length ||
            (await tx.find('jobRequests', { draftRevisionId: id })).length ||
            (await tx.find('permits', { draftRevisionId: id })).length)
        )
          continue;
        if (table === 'drafts' && (await tx.find('revisions', { draftId: id })).length) continue;
        if (
          table === 'captures' &&
          ((await tx.find('drafts', { captureId: id })).length ||
            (await tx.find('events', { captureId: id })).length)
        )
          continue;
        if (table === 'snapshots') {
          await this.orphanSnapshot(tx, id);
          continue;
        }
        if (
          table === 'sourceProducts' &&
          ((await tx.find('snapshots', { productId: id })).length ||
            (await tx.find('events', { productId: id })).length ||
            (await tx.find('dailyStats', { productId: id })).length)
        )
          continue;
        if (table === 'sourceStores' && (await tx.find('sourceProducts', { storeId: id })).length)
          continue;
        if (table === 'buckets') {
          const r = row as Rows['buckets'];
          await tx.delete('buckets', {
            keyHash: r.keyHash,
            windowStart: r.windowStart,
            windowSeconds: r.windowSeconds,
          });
          continue;
        }
        if (table === 'sessions') {
          const r = row as Rows['sessions'];
          if (+r.expiresAt > +cutoff && (!r.revokedAt || +r.revokedAt > +cutoff)) continue;
        }
        if (table === 'usageCounters') {
          const r = row as Rows['usageCounters'];
          if (
            (await tx.find('jobs', { quotaPeriodStart: r.periodStart })).some(
              (j) => !terminal.includes(j.state),
            )
          )
            continue;
        }
        if (table === 'deletions' && (row as Rows['deletions']).state !== 'complete') continue;
        await tx.delete(table, { id } as never);
      }
      const next = {
        phase:
          rows.length === 25 && table !== 'buckets'
            ? state.phase
            : (state.phase + 1) % phases.length,
        cursor:
          rows.length === 25 && table !== 'buckets' ? (rows.at(-1) as { id: string }).id : null,
      };
      if (existing)
        await tx.update(
          'heartbeats',
          { name: 'retention' },
          { metadataJson: next, lastSeenAt: now },
        );
      else
        await tx.insert('heartbeats', {
          name: 'retention',
          metadataJson: next,
          lastSeenAt: now,
          createdAt: now,
        });
      return rows.length;
    });
  }
  async rollup() {
    const now = this.auth.now();
    const state = await this.auth.store.transaction(async (tx) => {
      const row = (await tx.find('heartbeats', { name: 'daily-rollup' }))[0];
      const parsed = z
        .object({
          generation: z.string(),
          day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          offset: z.number().int().nonnegative(),
          clearing: z.boolean(),
        })
        .catch({
          generation: randomUUID(),
          day: new Date(+now - 89 * day).toISOString().slice(0, 10),
          offset: 0,
          clearing: true,
        })
        .parse(row?.metadataJson);
      if (!row || (row.metadataJson as { generation?: string }).generation !== parsed.generation)
        await this.rollupState(tx, parsed);
      return (await tx.find('heartbeats', { name: 'daily-rollup' }))[0]!
        .metadataJson as typeof parsed;
    });
    const start = new Date(state.day + 'T00:00:00.000Z'),
      end = new Date(Math.min(+start + day - 1, +now));
    if (+start > +now) return;
    if (state.clearing) {
      await this.auth.store.transaction(async (tx) => {
        if (!(await this.currentRollup(tx, state.generation))) return;
        const rows = await tx.scan('dailyStats', { where: { dayUtc: start }, limit: 25 });
        for (const r of rows) await tx.delete('dailyStats', { id: r.id });
        if (rows.length < 25) await this.rollupState(tx, { ...state, clearing: false });
      });
      return;
    }
    const rows = await this.auth.store.trends({
      from: start,
      to: end,
      metric: 'capture',
      offset: state.offset,
      limit: 25,
    });
    await this.auth.store.transaction(async (tx) => {
      if (!(await this.currentRollup(tx, state.generation))) return;
      for (const raw of rows) {
        const v = z
          .object({
            productId: z.uuid(),
            captureCount: z.coerce.number(),
            exportCount: z.coerce.number(),
            anonymousCaptureActors: z.coerce.number(),
            accountCaptureActors: z.coerce.number(),
            anonymousExportActors: z.coerce.number(),
            accountExportActors: z.coerce.number(),
          })
          .parse(raw);
        const prior = (await tx.find('dailyStats', { dayUtc: start, productId: v.productId }))[0];
        if (prior) await tx.update('dailyStats', { id: prior.id }, { ...v, updatedAt: now });
        else if ((await tx.find('sourceProducts', { id: v.productId })).length)
          await tx.insert('dailyStats', {
            id: randomUUID(),
            dayUtc: start,
            ...v,
            createdAt: now,
            updatedAt: now,
          });
      }
      const next =
        rows.length === 25
          ? { ...state, offset: state.offset + 25 }
          : {
              day: new Date(+start + day > +now ? +now - 89 * day : +start + day)
                .toISOString()
                .slice(0, 10),
              offset: 0,
              clearing: true,
            };
      await this.rollupState(tx, next);
    });
  }
  async currentRollup(tx: AuthTransaction, generation: string) {
    const row = (await tx.find('heartbeats', { name: 'daily-rollup' }))[0];
    return (row?.metadataJson as { generation?: string } | undefined)?.generation === generation;
  }
  async rollupState(tx: AuthTransaction, input: object) {
    const state = { ...input, generation: randomUUID() };
    const row = (await tx.find('heartbeats', { name: 'daily-rollup' }))[0],
      now = this.auth.now();
    if (row)
      await tx.update(
        'heartbeats',
        { name: 'daily-rollup' },
        { metadataJson: state, lastSeenAt: now },
      );
    else
      await tx.insert('heartbeats', {
        name: 'daily-rollup',
        metadataJson: state,
        lastSeenAt: now,
        createdAt: now,
      });
  }
  async tick() {
    await this.personalBatch();
    await this.retentionBatch();
    await this.rollup();
  }
}
