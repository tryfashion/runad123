import { and, eq, isNull, desc, type SQL, type AnyColumn, sql, or, lte, asc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { tables, type Rows } from './schema.js';
import { createDatabase } from './index.js';

export type TableName = keyof Rows;
export interface AuthTransaction {
  scan<K extends TableName>(
    table: K,
    options?: {
      where?: Partial<Rows[K]>;
      before?: { field: keyof Rows[K]; value: Date };
      after?: string;
      limit?: number;
    },
  ): Promise<Rows[K][]>;
  delete<K extends TableName>(table: K, where: Partial<Rows[K]>): Promise<void>;
  find<K extends TableName>(table: K, where: Partial<Rows[K]>): Promise<Rows[K][]>;
  insert<K extends TableName>(table: K, row: Rows[K]): Promise<void>;
  update<K extends TableName>(
    table: K,
    where: Partial<Rows[K]>,
    patch: Partial<Rows[K]>,
  ): Promise<void>;
}
export interface AuthStore {
  trends(input: {
    from: Date;
    to: Date;
    metric: 'export' | 'capture';
    offset: number;
    limit: number;
  }): Promise<Record<string, unknown>[]>;
  overview(from: Date, to: Date): Promise<Record<string, unknown>>;
  claimJob(workerId: string, now: Date): Promise<Rows['jobs'] | null>;
  renewJob(id: string, token: string, now: Date): Promise<boolean>;
  transaction<T>(operation: (tx: AuthTransaction) => Promise<T>): Promise<T>;
}

function predicate<K extends TableName>(name: K, where: Partial<Rows[K]>): SQL {
  const conditions = Object.entries(where).map(([key, value]) => {
    const column = (tables[name] as unknown as Record<string, AnyColumn>)[key];
    if (!column || value === undefined) throw new Error('INVALID_DATABASE_FILTER');
    return value === null ? isNull(column) : eq(column, value);
  });
  if (!conditions.length) throw new Error('EMPTY_DATABASE_FILTER');
  return and(...conditions)!;
}

export function createAuthStore(uri: string): AuthStore & { close(): Promise<void> } {
  const connection = createDatabase(uri);
  return {
    close: connection.close,
    async trends({ from, to, metric, offset, limit }) {
      const order =
        metric === 'export'
          ? sql`exportActors DESC,exportCount DESC,lastExport DESC,productId ASC`
          : sql`captureActors DESC,captureCount DESC,lastCapture DESC,productId ASC`;
      const result = await connection.db
        .execute(sql`SELECT p.id AS productId,p.handle,p.canonical_url AS url,
      SUM(e.event_type='capture_created') AS captureCount,SUM(e.event_type='download_completed') AS exportCount,
      COUNT(DISTINCT CASE WHEN e.event_type='capture_created' THEN e.actor_key END) AS captureActors,
      COUNT(DISTINCT CASE WHEN e.event_type='download_completed' THEN e.actor_key END) AS exportActors,
      COUNT(DISTINCT CASE WHEN e.event_type='capture_created' AND e.user_id_at_event IS NULL THEN e.actor_key END) AS anonymousCaptureActors,
      COUNT(DISTINCT CASE WHEN e.event_type='capture_created' AND e.user_id_at_event IS NOT NULL THEN e.actor_key END) AS accountCaptureActors,
      COUNT(DISTINCT CASE WHEN e.event_type='download_completed' AND e.user_id_at_event IS NULL THEN e.actor_key END) AS anonymousExportActors,
      COUNT(DISTINCT CASE WHEN e.event_type='download_completed' AND e.user_id_at_event IS NOT NULL THEN e.actor_key END) AS accountExportActors,
      MAX(CASE WHEN e.event_type='download_completed' THEN e.received_at END) AS lastExport,
      MAX(CASE WHEN e.event_type='capture_created' THEN e.received_at END) AS lastCapture
      FROM operation_events e JOIN source_products p ON p.id=e.product_id
      WHERE e.received_at>=${from} AND e.received_at<=${to} AND e.event_type IN ('capture_created','download_completed')
      GROUP BY p.id,p.handle,p.canonical_url ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`);
      return result[0] as unknown as Record<string, unknown>[];
    },
    async overview(from, to) {
      const [counts] = await connection.db.execute(sql`SELECT
      (SELECT COUNT(*) FROM users WHERE status='active') AS users,
      (SELECT COUNT(*) FROM installations WHERE status='active') AS installations,
      (SELECT COUNT(*) FROM operation_events WHERE event_type='capture_created' AND received_at>=${from} AND received_at<=${to}) AS captures,
      (SELECT COUNT(*) FROM operation_events WHERE event_type='download_completed' AND received_at>=${from} AND received_at<=${to}) AS downloads,
      (SELECT COUNT(*) FROM jobs WHERE created_at>=${from} AND created_at<=${to}) AS totalJobs,
      (SELECT COUNT(*) FROM job_attempts WHERE started_at>=${from} AND started_at<=${to}) AS totalAttempts,
      (SELECT COUNT(*) FROM jobs WHERE created_at>=${from} AND created_at<=${to} AND state='failed') AS failedJobs,
      (SELECT COUNT(*) FROM job_attempts WHERE started_at>=${from} AND started_at<=${to} AND (state='unknown' OR estimated_cost IS NULL)) AS unknownAttempts,
      (SELECT SUM(estimated_cost) FROM job_attempts WHERE started_at>=${from} AND started_at<=${to}) AS knownCost,
      (SELECT COUNT(*) FROM job_attempts WHERE started_at>=${from} AND started_at<=${to} AND attempt_no>1) AS retries`);
      const [daily] = await connection.db.execute(
        sql`SELECT DATE(received_at) AS day,SUM(event_type='capture_created') AS captureCount,SUM(event_type='download_completed') AS exportCount FROM operation_events WHERE received_at>=${from} AND received_at<=${to} AND event_type IN ('capture_created','download_completed') GROUP BY DATE(received_at) ORDER BY day`,
      );
      return { ...(counts as unknown as Record<string, unknown>[])[0]!, daily };
    },
    claimJob: (workerId, now) =>
      connection.db.transaction(async (tx) => {
        const j = tables.jobs;
        const [job] = await tx
          .select()
          .from(j)
          .where(
            or(
              and(sql`${j.state} in ('queued','retry_wait')`, lte(j.nextRunAt, now)),
              and(eq(j.state, 'running'), lte(j.leaseUntil, now)),
              and(eq(j.state, 'blocked_auth'), lte(j.deadlineAt, now)),
            ),
          )
          .orderBy(asc(j.nextRunAt), asc(j.createdAt))
          .limit(1)
          .for('update', { skipLocked: true });
        if (!job) return null;
        const patch = {
          state: 'running',
          leaseToken: randomUUID(),
          leaseUntil: new Date(+now + 120000),
          workerId,
          updatedAt: now,
        };
        await tx.update(j).set(patch).where(eq(j.id, job.id));
        return { ...job, ...patch };
      }),
    renewJob: async (id, token, now) => {
      const [result] = await connection.db
        .update(tables.jobs)
        .set({ leaseUntil: new Date(+now + 120000), updatedAt: now })
        .where(
          and(
            eq(tables.jobs.id, id),
            eq(tables.jobs.leaseToken, token),
            eq(tables.jobs.state, 'running'),
            sql`${tables.jobs.leaseUntil}>${now}`,
          ),
        );
      return result.affectedRows === 1;
    },
    transaction: (operation) =>
      connection.db.transaction(async (tx) => {
        // A single, short M1 identity lock gives consistent lock order across all processes.
        // No SMTP/network operations run under it. Replace only with measured, tested lock ordering.
        const gate = await tx
          .select()
          .from(tables.settings)
          .where(eq(tables.settings.key, 'access_mode'))
          .for('update');
        if (gate.length !== 1) throw new Error('DATABASE_NOT_MIGRATED');
        const adapter: AuthTransaction = {
          async scan<K extends TableName>(
            name: K,
            options: {
              where?: Partial<Rows[K]>;
              before?: { field: keyof Rows[K]; value: Date };
              after?: string;
              limit?: number;
            } = {},
          ) {
            const columns = tables[name] as unknown as Record<string, AnyColumn>,
              key = columns.id ?? columns.key ?? columns.name;
            const conditions: SQL[] = [];
            if (options.where && Object.keys(options.where).length)
              conditions.push(predicate(name, options.where));
            if (options.before) {
              const field = columns[String(options.before.field)];
              if (!field) throw new Error('INVALID_DATABASE_FILTER');
              conditions.push(sql`${field}<${options.before.value}`);
            }
            if (options.after) {
              if (!key) throw new Error('CURSOR_NOT_SUPPORTED');
              conditions.push(sql`${key}>${options.after}`);
            }
            return (await tx
              .select()
              .from(tables[name])
              .where(and(...conditions))
              .orderBy(asc(key ?? columns.createdAt!))
              .limit(Math.min(100, Math.max(1, options.limit ?? 50)))
              .for('update')) as Rows[K][];
          },
          async delete(name, where) {
            await tx.delete(tables[name]).where(predicate(name, where));
          },
          async find<K extends TableName>(name: K, where: Partial<Rows[K]>) {
            return (await tx
              .select()
              .from(tables[name])
              .where(predicate(name, where))
              .orderBy(desc(tables[name].createdAt))
              .limit(100)
              .for('update')) as Rows[K][];
          },
          async insert(name, row) {
            await tx.insert(tables[name]).values(row as never);
          },
          async update(name, where, patch) {
            await tx
              .update(tables[name])
              .set(patch as never)
              .where(predicate(name, where));
          },
        };
        return operation(adapter);
      }),
  };
}
