import { randomUUID } from 'node:crypto';
import { serialize, deserialize } from 'node:v8';
import type { AuthStore, AuthTransaction, Rows, TableName } from '../../packages/db/src/index.js';

const copy = <T>(value: T): T => deserialize(serialize(value)) as T;
function matches(row: unknown, where: unknown) {
  return Object.entries(where as Record<string, unknown>).every(([key, value]) => {
    const actual = (row as Record<string, unknown>)[key];
    if (Buffer.isBuffer(value)) return Buffer.isBuffer(actual) && value.equals(actual);
    if (value instanceof Date) return actual instanceof Date && +value === +actual;
    return value === actual;
  });
}
// Transaction model for isolated business tests, not a MySQL substitute or integration test.
export class MemoryAuthStore implements AuthStore {
  rows: { [K in TableName]: Rows[K][] } = {
    members: [],
    adminCredentials: [],
    tutorials: [],
    deletions: [],
    dailyStats: [],
    permits: [],
    jobs: [],
    jobRequests: [],
    jobAttempts: [],
    usageCounters: [],
    heartbeats: [],
    sourceStores: [],
    sourceProducts: [],
    snapshots: [],
    captures: [],
    drafts: [],
    revisions: [],
    events: [],
    users: [],
    installations: [],
    sessions: [],
    challenges: [],
    buckets: [],
    settings: [
      {
        key: 'access_mode',
        valueJson: 'anonymous_allowed',
        version: 1,
        updatedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    audits: [],
  };
  async trends({
    from,
    to,
    metric,
    offset,
    limit,
  }: {
    from: Date;
    to: Date;
    metric: 'export' | 'capture';
    offset: number;
    limit: number;
  }) {
    const groups = this.rows.sourceProducts
      .map((p) => {
        const rows = this.rows.events.filter(
            (e) => e.productId === p.id && +e.receivedAt >= +from && +e.receivedAt <= +to,
          ),
          cap = rows.filter((e) => e.eventType === 'capture_created'),
          exp = rows.filter((e) => e.eventType === 'download_completed');
        const count = (r: typeof rows) => new Set(r.map((e) => e.actorKey)).size;
        return {
          productId: p.id,
          handle: p.handle,
          url: p.canonicalUrl,
          captureCount: cap.length,
          exportCount: exp.length,
          captureActors: count(cap),
          exportActors: count(exp),
          anonymousCaptureActors: count(cap.filter((e) => !e.userIdAtEvent)),
          accountCaptureActors: count(cap.filter((e) => !!e.userIdAtEvent)),
          anonymousExportActors: count(exp.filter((e) => !e.userIdAtEvent)),
          accountExportActors: count(exp.filter((e) => !!e.userIdAtEvent)),
          lastExport: exp.sort((a, b) => +b.receivedAt - +a.receivedAt)[0]?.receivedAt ?? null,
          lastCapture: cap.sort((a, b) => +b.receivedAt - +a.receivedAt)[0]?.receivedAt ?? null,
        };
      })
      .filter((r) => r.captureCount || r.exportCount);
    groups.sort((a, b) =>
      metric === 'export'
        ? b.exportActors - a.exportActors ||
          b.exportCount - a.exportCount ||
          Number(b.lastExport) - Number(a.lastExport) ||
          a.productId.localeCompare(b.productId)
        : b.captureActors - a.captureActors ||
          b.captureCount - a.captureCount ||
          Number(b.lastCapture) - Number(a.lastCapture) ||
          a.productId.localeCompare(b.productId),
    );
    return groups.slice(offset, offset + limit);
  }
  async overview(from: Date, to: Date) {
    const attempts = this.rows.jobAttempts.filter(
        (a) => +a.startedAt >= +from && +a.startedAt <= +to,
      ),
      costs = attempts.filter((a) => a.estimatedCost !== null);
    return {
      totalJobs: this.rows.jobs.filter((j) => +j.createdAt >= +from && +j.createdAt <= +to).length,
      totalAttempts: attempts.length,
      users: this.rows.users.filter((u) => u.status === 'active').length,
      installations: this.rows.installations.filter((i) => i.status === 'active').length,
      captures: this.rows.events.filter(
        (e) => e.eventType === 'capture_created' && +e.receivedAt >= +from && +e.receivedAt <= +to,
      ).length,
      downloads: this.rows.events.filter(
        (e) =>
          e.eventType === 'download_completed' && +e.receivedAt >= +from && +e.receivedAt <= +to,
      ).length,
      failedJobs: this.rows.jobs.filter(
        (j) => j.state === 'failed' && +j.createdAt >= +from && +j.createdAt <= +to,
      ).length,
      unknownAttempts: attempts.filter((a) => a.estimatedCost === null || a.state === 'unknown')
        .length,
      knownCost: costs.length
        ? costs.reduce((n, a) => n + Number(a.estimatedCost), 0).toFixed(6)
        : null,
      retries: attempts.filter((a) => a.attemptNo > 1).length,
    };
  }
  async claimJob(workerId: string, now: Date) {
    return this.transaction(async (tx) => {
      const job = this.rows.jobs.find(
        (j) =>
          ((j.state === 'queued' || j.state === 'retry_wait') && +j.nextRunAt <= +now) ||
          (j.state === 'running' && j.leaseUntil && +j.leaseUntil <= +now) ||
          (j.state === 'blocked_auth' && +j.deadlineAt <= +now),
      );
      if (!job) return null;
      await tx.update(
        'jobs',
        { id: job.id },
        {
          state: 'running',
          leaseToken: randomUUID(),
          leaseUntil: new Date(+now + 120000),
          workerId,
        },
      );
      return copy(this.rows.jobs.find((j) => j.id === job.id)!);
    });
  }
  async renewJob(id: string, token: string, now: Date) {
    return this.transaction(async (tx) => {
      const job = this.rows.jobs.find(
        (j) =>
          j.id === id &&
          j.leaseToken === token &&
          j.state === 'running' &&
          j.leaseUntil &&
          +j.leaseUntil > +now,
      );
      if (!job) return false;
      await tx.update('jobs', { id }, { leaseUntil: new Date(+now + 120000) });
      return true;
    });
  }
  private queue: Promise<unknown> = Promise.resolve();
  transaction<T>(work: (tx: AuthTransaction) => Promise<T>): Promise<T> {
    const task = this.queue
      .catch(() => undefined)
      .then(async () => {
        const before = copy(this.rows);
        const tx: AuthTransaction = {
          scan: async <K extends TableName>(
            table: K,
            options: {
              where?: Partial<Rows[K]>;
              before?: { field: keyof Rows[K]; value: Date };
              after?: string;
              limit?: number;
            } = {},
          ) =>
            copy(
              this.rows[table]
                .filter(
                  (row) =>
                    matches(row, options.where ?? {}) &&
                    (!options.before ||
                      Number(row[options.before.field]) < +options.before.value) &&
                    (!options.after ||
                      String((row as unknown as { id: string }).id) > options.after),
                )
                .sort((a, b) =>
                  String((a as unknown as { id: string }).id).localeCompare(
                    String((b as unknown as { id: string }).id),
                  ),
                )
                .slice(0, Math.min(100, options.limit ?? 50)),
            ),
          delete: async <K extends TableName>(table: K, where: Partial<Rows[K]>) => {
            this.rows[table] = this.rows[table].filter(
              (row) => !matches(row, where),
            ) as (typeof this.rows)[K];
          },
          find: async <K extends TableName>(table: K, where: Partial<Rows[K]>) =>
            copy(this.rows[table].filter((row) => matches(row, where))),
          insert: async <K extends TableName>(table: K, row: Rows[K]) => {
            (this.rows[table] as Rows[K][]).push(copy(row));
          },
          update: async (table, where, patch) => {
            for (const row of this.rows[table])
              if (matches(row, where)) Object.assign(row, copy(patch));
          },
        };
        try {
          return await work(tx);
        } catch (error) {
          this.rows = before;
          throw error;
        }
      });
    this.queue = task;
    return task;
  }
}
