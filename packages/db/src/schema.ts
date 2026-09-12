import { sql } from 'drizzle-orm';
import {
  type AnyMySqlColumn,
  mysqlTable,
  char,
  varchar,
  datetime,
  int,
  json,
  customType,
  index,
  uniqueIndex,
  primaryKey,
  check,
  decimal,
  boolean as booleanColumn,
} from 'drizzle-orm/mysql-core';

const binary = customType<{ data: Buffer; driverData: Buffer; config: { length: number } }>({
  dataType: (config) => `binary(${config?.length ?? 32})`,
  fromDriver: (value) => Buffer.from(value),
  toDriver: (value) => value,
});
const uuidColumn = customType<{ data: string; driverData: string }>({
  dataType: () => 'char(36) character set ascii collate ascii_bin',
});
const id = (name: string) => uuidColumn(name);
const time = (name: string) => datetime(name, { mode: 'date', fsp: 3 });
const created = () => time('created_at').notNull();
const updated = () => time('updated_at').notNull();
export const users = mysqlTable(
  'users',
  {
    id: id('id').primaryKey(),
    emailNormalized: varchar('email_normalized', { length: 254 }).notNull(),
    emailDisplay: varchar('email_display', { length: 254 }).notNull(),
    role: varchar('role', { length: 16 }).$type<'user' | 'admin'>().notNull(),
    status: varchar('status', { length: 16 }).$type<'active' | 'disabled'>().notNull(),
    lastLoginAt: time('last_login_at'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex('users_email_unique').on(t.emailNormalized),
    check('users_role', sql`${t.role} in ('user','admin')`),
    check('users_status', sql`${t.status} in ('active','disabled')`),
  ],
);
export const installations = mysqlTable(
  'installations',
  {
    id: id('id').primaryKey(),
    status: varchar('status', { length: 16 }).$type<'active' | 'disabled'>().notNull(),
    consentVersion: varchar('consent_version', { length: 32 }).notNull(),
    consentedAt: time('consented_at').notNull(),
    linkedUserId: id('linked_user_id').references(() => users.id, { onDelete: 'restrict' }),
    linkedAt: time('linked_at'),
    lastSeenAt: time('last_seen_at').notNull(),
    extensionVersion: varchar('extension_version', { length: 32 }).notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    index('installations_user').on(t.linkedUserId),
    check('installations_status', sql`${t.status} in ('active','disabled')`),
  ],
);
export const sessions = mysqlTable(
  'sessions',
  {
    id: id('id').primaryKey(),
    tokenHash: binary('token_hash', { length: 32 }).notNull(),
    kind: varchar('kind', { length: 16 }).$type<'anonymous' | 'extension' | 'web'>().notNull(),
    installationId: id('installation_id').references(() => installations.id, {
      onDelete: 'restrict',
    }),
    userId: id('user_id').references(() => users.id, { onDelete: 'restrict' }),
    expiresAt: time('expires_at').notNull(),
    lastSeenAt: time('last_seen_at').notNull(),
    revokedAt: time('revoked_at'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex('sessions_token_unique').on(t.tokenHash),
    index('sessions_user_revoked').on(t.userId, t.revokedAt),
    index('sessions_installation').on(t.installationId),
    check(
      'sessions_identity',
      sql`(${t.kind}='anonymous' and ${t.installationId} is not null and ${t.userId} is null) or (${t.kind}='extension' and ${t.installationId} is not null and ${t.userId} is not null) or (${t.kind}='web' and ${t.installationId} is null and ${t.userId} is not null)`,
    ),
  ],
);
export const challenges = mysqlTable(
  'auth_challenges',
  {
    id: id('id').primaryKey(),
    emailNormalized: varchar('email_normalized', { length: 254 }).notNull(),
    installationId: id('installation_id').references(() => installations.id, {
      onDelete: 'restrict',
    }),
    preAuthHash: binary('pre_auth_hash', { length: 32 }),
    codeHmac: binary('code_hmac', { length: 32 }),
    state: varchar('state', { length: 16 }).$type<'pending' | 'sent' | 'failed'>().notNull(),
    expiresAt: time('expires_at').notNull(),
    attempts: int('attempts').notNull(),
    consumedAt: time('consumed_at'),
    clientKind: varchar('client_kind', { length: 16 }).$type<'web' | 'extension'>().notNull(),
    deliveryLocale: varchar('delivery_locale', { length: 16 })
      .$type<'zh-Hans' | 'zh-Hant' | 'en'>()
      .notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    index('challenges_email_created').on(t.emailNormalized, t.createdAt),
    check(
      'challenge_binding',
      sql`(${t.clientKind}='web' and ${t.preAuthHash} is not null and ${t.installationId} is null) or (${t.clientKind}='extension' and ${t.installationId} is not null and ${t.preAuthHash} is null)`,
    ),
    check('challenge_state', sql`${t.state} in ('pending','sent','failed')`),
    check('challenge_attempts', sql`${t.attempts} between 0 and 5`),
    check('challenge_locale', sql`${t.deliveryLocale} in ('zh-Hans','zh-Hant','en')`),
  ],
);
export const buckets = mysqlTable(
  'rate_limit_buckets',
  {
    keyHash: binary('key_hash', { length: 32 }).notNull(),
    windowStart: time('window_start').notNull(),
    windowSeconds: int('window_seconds').notNull(),
    count: int('count').notNull(),
    expiresAt: time('expires_at').notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    primaryKey({ columns: [t.keyHash, t.windowStart, t.windowSeconds] }),
    index('buckets_expiry').on(t.expiresAt),
  ],
);
export const settings = mysqlTable('settings', {
  key: varchar('key', { length: 64 }).primaryKey(),
  valueJson: json('value_json').$type<unknown>().notNull(),
  version: int('version').notNull(),
  updatedBy: id('updated_by').references(() => users.id, { onDelete: 'restrict' }),
  createdAt: created(),
  updatedAt: updated(),
});
export const audits = mysqlTable(
  'admin_audit_logs',
  {
    id: id('id').primaryKey(),
    adminUserId: id('admin_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    action: varchar('action', { length: 64 }).notNull(),
    targetType: varchar('target_type', { length: 32 }).notNull(),
    targetId: varchar('target_id', { length: 64 }).notNull(),
    beforeJson: json('before_json').$type<unknown>(),
    afterJson: json('after_json').$type<unknown>(),
    requestId: id('request_id').notNull(),
    createdAt: created(),
  },
  (t) => [index('audit_user_created').on(t.adminUserId, t.createdAt)],
);
export const adminCredentials = mysqlTable(
  'admin_credentials',
  {
    userId: id('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'restrict' }),
    loginNormalized: varchar('login_normalized', { length: 254 }).notNull(),
    passwordSalt: binary('password_salt', { length: 16 }).notNull(),
    passwordHash: binary('password_hash', { length: 64 }).notNull(),
    passwordVersion: varchar('password_version', { length: 32 }).notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex('admin_credentials_login').on(t.loginNormalized)],
);

export const sourceStores = mysqlTable(
  'source_stores',
  {
    id: id('id').primaryKey(),
    canonicalHost: varchar('canonical_host', { length: 253 }).notNull(),
    myshopifyHost: varchar('myshopify_host', { length: 253 }),
    platform: varchar('platform', { length: 16 }).notNull(),
    firstSeenAt: time('first_seen_at').notNull(),
    lastSeenAt: time('last_seen_at').notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex('source_stores_host').on(t.canonicalHost)],
);
export const sourceProducts = mysqlTable(
  'source_products',
  {
    id: id('id').primaryKey(),
    storeId: id('store_id')
      .notNull()
      .references(() => sourceStores.id, { onDelete: 'restrict' }),
    sourceProductId: varchar('source_product_id', { length: 32 }).notNull(),
    handle: varchar('handle', { length: 512 }).notNull(),
    canonicalUrl: varchar('canonical_url', { length: 2048 }).notNull(),
    latestSnapshotId: id('latest_snapshot_id').references((): AnyMySqlColumn => snapshots.id, {
      onDelete: 'restrict',
    }),
    firstSeenAt: time('first_seen_at').notNull(),
    lastSeenAt: time('last_seen_at').notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex('source_product_store_id').on(t.storeId, t.sourceProductId),
    index('source_product_seen').on(t.lastSeenAt),
  ],
);
export const snapshots = mysqlTable(
  'product_snapshots',
  {
    id: id('id').primaryKey(),
    productId: id('source_product_id')
      .notNull()
      .references(() => sourceProducts.id, { onDelete: 'restrict' }),
    contentHash: binary('content_hash', { length: 32 }).notNull(),
    schemaVersion: int('schema_version').notNull(),
    productJson: json('product_json').$type<unknown>().notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    marketCountry: varchar('market_country', { length: 2 }),
    capturedAt: time('captured_at').notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex('snapshots_content').on(t.productId, t.contentHash, t.schemaVersion)],
);
export const captures = mysqlTable(
  'captures',
  {
    id: id('id').primaryKey(),
    installationId: id('installation_id')
      .notNull()
      .references(() => installations.id, { onDelete: 'restrict' }),
    userIdAtCapture: id('user_id_at_capture').references(() => users.id, { onDelete: 'restrict' }),
    snapshotId: id('snapshot_id')
      .notNull()
      .references(() => snapshots.id, { onDelete: 'restrict' }),
    clientActionId: id('client_action_id').notNull(),
    payloadHash: binary('payload_hash', { length: 32 }).notNull(),
    sourceMethod: varchar('source_method', { length: 32 }).notNull(),
    completeness: varchar('completeness', { length: 16 }).notNull(),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex('captures_action').on(t.installationId, t.clientActionId),
    index('captures_snapshot_time').on(t.snapshotId, t.createdAt),
    index('captures_user_time').on(t.userIdAtCapture, t.createdAt),
  ],
);
export const drafts = mysqlTable(
  'drafts',
  {
    id: id('id').primaryKey(),
    captureId: id('capture_id')
      .notNull()
      .references(() => captures.id, { onDelete: 'restrict' }),
    installationId: id('installation_id')
      .notNull()
      .references(() => installations.id, { onDelete: 'restrict' }),
    userId: id('user_id').references(() => users.id, { onDelete: 'restrict' }),
    currentRevision: int('current_revision').notNull(),
    archivedAt: time('archived_at'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex('drafts_capture').on(t.captureId),
    index('drafts_installation_time').on(t.installationId, t.createdAt),
    index('drafts_user_time').on(t.userId, t.createdAt),
  ],
);
export const revisions = mysqlTable(
  'draft_revisions',
  {
    id: id('id').primaryKey(),
    draftId: id('draft_id')
      .notNull()
      .references(() => drafts.id, { onDelete: 'restrict' }),
    revision: int('revision').notNull(),
    preparedProductJson: json('prepared_product_json').$type<unknown>(),
    exportSettingsJson: json('export_settings_json').$type<unknown>(),
    targetCountry: varchar('target_country', { length: 2 }).notNull(),
    language: varchar('language', { length: 16 }).notNull(),
    textHash: binary('text_hash', { length: 32 }).notNull(),
    exportHash: binary('export_hash', { length: 32 }).notNull(),
    normalizerVersion: int('normalizer_version').notNull(),
    csvMappingVersion: int('csv_mapping_version').notNull(),
    payloadPurgedAt: time('payload_purged_at'),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex('draft_revisions_number').on(t.draftId, t.revision),
    index('revision_text_hash').on(t.textHash),
  ],
);
export const events = mysqlTable(
  'operation_events',
  {
    id: id('id').primaryKey(),
    eventType: varchar('event_type', { length: 32 }).notNull(),
    captureId: id('capture_id')
      .notNull()
      .references(() => captures.id, { onDelete: 'restrict' }),
    exportPermitId: id('export_permit_id').references((): AnyMySqlColumn => permits.id),
    productId: id('product_id')
      .notNull()
      .references(() => sourceProducts.id, { onDelete: 'restrict' }),
    installationId: id('installation_id')
      .notNull()
      .references(() => installations.id, { onDelete: 'restrict' }),
    userIdAtEvent: id('user_id_at_event').references(() => users.id, { onDelete: 'restrict' }),
    actorKey: varchar('actor_key', { length: 38 }).notNull(),
    clientEventId: id('client_event_id').notNull(),
    occurredAt: time('occurred_at').notNull(),
    receivedAt: time('received_at').notNull(),
    origin: varchar('origin', { length: 16 }).notNull(),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex('events_client').on(t.installationId, t.clientEventId),
    uniqueIndex('events_permit_type').on(t.exportPermitId, t.eventType),
    index('events_type_time_product_actor').on(t.eventType, t.receivedAt, t.productId, t.actorKey),
    index('events_product_time').on(t.productId, t.receivedAt),
  ],
);
export const jobs = mysqlTable(
  'jobs',
  {
    id: id('id').primaryKey(),
    kind: varchar('kind', { length: 16 }).notNull(),
    principalType: varchar('principal_type', { length: 16 }).notNull(),
    principalId: id('principal_id').notNull(),
    installationId: id('installation_id')
      .notNull()
      .references(() => installations.id),
    draftRevisionId: id('draft_revision_id').references(() => revisions.id),
    cacheKey: binary('cache_key', { length: 32 }).notNull(),
    generation: int('generation').notNull(),
    state: varchar('state', { length: 16 }).notNull(),
    inputJson: json('input_json').$type<unknown>(),
    resultJson: json('result_json').$type<unknown>(),
    reportLocale: varchar('report_locale', { length: 16 }).notNull(),
    model: varchar('model', { length: 100 }).notNull(),
    promptVersion: varchar('prompt_version', { length: 64 }).notNull(),
    schemaVersion: int('schema_version').notNull(),
    attempts: int('attempts').notNull(),
    maxAttempts: int('max_attempts').notNull(),
    nextRunAt: time('next_run_at').notNull(),
    leaseUntil: time('lease_until'),
    leaseToken: id('lease_token'),
    workerId: varchar('worker_id', { length: 100 }),
    startedAt: time('started_at'),
    finishedAt: time('finished_at'),
    deadlineAt: time('deadline_at').notNull(),
    expiresAt: time('expires_at'),
    errorCode: varchar('error_code', { length: 64 }),
    inputTokens: int('input_tokens'),
    outputTokens: int('output_tokens'),
    estimatedCost: decimal('estimated_cost', { precision: 20, scale: 6 }),
    pricingVersion: varchar('pricing_version', { length: 64 }).notNull(),
    quotaPeriodStart: time('quota_period_start').notNull(),
    reservedCost: decimal('reserved_cost', { precision: 20, scale: 6 }).notNull(),
    configJson: json('config_json').$type<unknown>().notNull(),
    settledAt: time('settled_at'),
    invalidResponses: int('invalid_responses').notNull(),
    payloadPurgedAt: time('payload_purged_at'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex('jobs_cache_generation').on(t.cacheKey, t.generation),
    index('jobs_ready').on(t.state, t.nextRunAt, t.createdAt),
    index('jobs_lease').on(t.state, t.leaseUntil),
    index('jobs_principal').on(t.principalType, t.principalId, t.createdAt),
    check('jobs_attempt_bound', sql`${t.attempts} between 0 and 3`),
    check(
      'jobs_state',
      sql`${t.state} in ('queued','running','retry_wait','succeeded','failed','cancelled','blocked_auth')`,
    ),
  ],
);
export const jobRequests = mysqlTable(
  'job_requests',
  {
    id: id('id').primaryKey(),
    jobId: id('job_id')
      .notNull()
      .references(() => jobs.id),
    draftRevisionId: id('draft_revision_id')
      .notNull()
      .references(() => revisions.id),
    principalType: varchar('principal_type', { length: 16 }).notNull(),
    principalId: id('principal_id').notNull(),
    installationId: id('installation_id')
      .notNull()
      .references(() => installations.id),
    clientActionId: id('client_action_id').notNull(),
    kind: varchar('kind', { length: 16 }).notNull(),
    state: varchar('state', { length: 16 }).notNull(),
    payloadHash: binary('payload_hash', { length: 32 }).notNull(),
    cacheHit: booleanColumn('cache_hit').notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex('requests_idempotent').on(t.installationId, t.clientActionId, t.kind),
    index('requests_job').on(t.jobId),
    index('requests_revision').on(t.draftRevisionId),
    index('requests_principal').on(t.principalType, t.principalId, t.createdAt),
  ],
);
export const jobAttempts = mysqlTable(
  'job_attempts',
  {
    id: id('id').primaryKey(),
    jobId: id('job_id')
      .notNull()
      .references(() => jobs.id),
    attemptNo: int('attempt_no').notNull(),
    leaseToken: id('lease_token').notNull(),
    state: varchar('state', { length: 16 }).notNull(),
    providerRequestId: varchar('provider_request_id', { length: 256 }),
    startedAt: time('started_at').notNull(),
    finishedAt: time('finished_at'),
    inputTokens: int('input_tokens'),
    outputTokens: int('output_tokens'),
    estimatedCost: decimal('estimated_cost', { precision: 20, scale: 6 }),
    pricingVersion: varchar('pricing_version', { length: 64 }).notNull(),
    reconciledAt: time('reconciled_at'),
    createdAt: created(),
  },
  (t) => [uniqueIndex('attempts_number').on(t.jobId, t.attemptNo)],
);
export const usageCounters = mysqlTable(
  'usage_counters',
  {
    id: id('id').primaryKey(),
    subjectType: varchar('subject_type', { length: 16 }).notNull(),
    subjectId: varchar('subject_id', { length: 36 }).notNull(),
    periodStart: time('period_start').notNull(),
    periodKind: varchar('period_kind', { length: 16 }).notNull(),
    operation: varchar('operation', { length: 16 }).notNull(),
    reservedCount: int('reserved_count').notNull(),
    startedCount: int('started_count').notNull(),
    completedCount: int('completed_count').notNull(),
    failedCount: int('failed_count').notNull(),
    reservedCost: decimal('reserved_cost', { precision: 20, scale: 6 }).notNull(),
    estimatedCost: decimal('estimated_cost', { precision: 20, scale: 6 }).notNull(),
    unknownCostCount: int('unknown_cost_count').notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex('usage_subject_period').on(
      t.subjectType,
      t.subjectId,
      t.periodStart,
      t.periodKind,
      t.operation,
    ),
    check(
      'usage_nonnegative',
      sql`${t.reservedCount}>=0 and ${t.reservedCost}>=0 and ${t.startedCount}>=0`,
    ),
  ],
);
export const heartbeats = mysqlTable('runtime_heartbeats', {
  name: varchar('name', { length: 100 }).primaryKey(),
  lastSeenAt: time('last_seen_at').notNull(),
  metadataJson: json('metadata_json').$type<unknown>().notNull(),
  createdAt: created(),
});

export const permits = mysqlTable(
  'export_permits',
  {
    id: id('id').primaryKey(),
    draftRevisionId: id('draft_revision_id')
      .notNull()
      .references(() => revisions.id),
    riskRequestId: id('risk_request_id')
      .notNull()
      .references(() => jobRequests.id),
    principalType: varchar('principal_type', { length: 16 }).notNull(),
    principalId: id('principal_id').notNull(),
    installationId: id('installation_id')
      .notNull()
      .references(() => installations.id),
    exportHash: binary('export_hash', { length: 32 }).notNull(),
    assessment: varchar('assessment', { length: 32 }).notNull(),
    severity: varchar('severity', { length: 16 }).notNull(),
    acknowledgedFindingsJson: json('acknowledged_findings_json').$type<string[]>().notNull(),
    acknowledgedAt: time('acknowledged_at'),
    expiresAt: time('expires_at').notNull(),
    clientActionId: id('client_action_id').notNull(),
    payloadHash: binary('payload_hash', { length: 32 }).notNull(),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex('permits_action').on(t.installationId, t.clientActionId),
    index('permits_revision').on(t.draftRevisionId, t.createdAt),
  ],
);
export const tutorials = mysqlTable(
  'tutorials',
  {
    id: id('id').primaryKey(),
    title: varchar('title', { length: 200 }).notNull(),
    summary: varchar('summary', { length: 1000 }).notNull(),
    url: varchar('url', { length: 2048 }).notNull(),
    contentLocale: varchar('content_locale', { length: 16 }).notNull(),
    category: varchar('category', { length: 32 }).notNull(),
    placement: varchar('placement', { length: 16 }).notNull(),
    sortOrder: int('sort_order').notNull(),
    enabled: booleanColumn('enabled').notNull(),
    version: int('version').notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index('tutorials_list').on(t.enabled, t.placement, t.contentLocale, t.sortOrder)],
);
export const deletions = mysqlTable(
  'data_deletions',
  {
    id: id('id').primaryKey(),
    principalType: varchar('principal_type', { length: 16 }).notNull(),
    principalId: id('principal_id').notNull(),
    state: varchar('state', { length: 16 }).notNull(),
    phase: varchar('phase', { length: 32 }).notNull(),
    cursor: varchar('progress_cursor', { length: 64 }),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index('deletions_pending').on(t.state, t.createdAt)],
);
export const dailyStats = mysqlTable(
  'product_daily_stats',
  {
    id: id('id').primaryKey(),
    dayUtc: time('day_utc').notNull(),
    productId: id('product_id')
      .notNull()
      .references(() => sourceProducts.id),
    captureCount: int('capture_count').notNull(),
    exportCount: int('export_count').notNull(),
    anonymousCaptureActors: int('anonymous_capture_actors').notNull(),
    accountCaptureActors: int('account_capture_actors').notNull(),
    anonymousExportActors: int('anonymous_export_actors').notNull(),
    accountExportActors: int('account_export_actors').notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex('daily_product_day').on(t.dayUtc, t.productId)],
);
export const tables = {
  adminCredentials,
  tutorials,
  deletions,
  dailyStats,
  permits,
  jobs,
  jobRequests,
  jobAttempts,
  usageCounters,
  heartbeats,
  users,
  installations,
  sessions,
  challenges,
  buckets,
  settings,
  audits,
  sourceStores,
  sourceProducts,
  snapshots,
  captures,
  drafts,
  revisions,
  events,
};
export type Rows = { [K in keyof typeof tables]: (typeof tables)[K]['$inferSelect'] };
