import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { TokenAudience } from '@opswatch/contract';
import {
  CONNECTION_METHODS,
  CONNECTION_STATUSES,
  type PermissionTestResult,
} from '../connections/types';

export const adminUser = sqliteTable('admin_user', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  adminUserId: integer('admin_user_id')
    .notNull()
    .references(() => adminUser.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  /**
   * Which kind of client this session was minted for: `web` for the browser cookie, `api` for a bearer token. A
   * session is only accepted where its own audience belongs, so neither can be replayed as the other. Rows written
   * before the API existed are browser sessions, which is what the default says.
   */
  audience: text('audience').notNull().default('web').$type<TokenAudience>(),
  /** Null until the session is presented a second time. `GET /me/sessions` shows it, so a stale device stands out. */
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
});

export const connections = sqliteTable('connections', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  method: text('method', { enum: CONNECTION_METHODS }).notNull(),
  awsAccountId: text('aws_account_id').notNull(),
  regions: text('regions', { mode: 'json' }).$type<string[]>().notNull(),
  roleArn: text('role_arn'),
  externalId: text('external_id'),
  templateVersion: integer('template_version'),
  accessKeyCiphertext: text('access_key_ciphertext'),
  status: text('status', { enum: CONNECTION_STATUSES }).notNull(),
  lastTest: text('last_test', { mode: 'json' }).$type<PermissionTestResult>(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * The instance's own settings. One admin, so one row, always `SETTINGS_ROW_ID`: no key column and no
 * per-user fan-out. Added on its own, next to `connections`, which this table never touches.
 */
export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey(),
  refreshIntervalMs: integer('refresh_interval_ms').notNull(),
  defaultRange: text('default_range').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export type ConnectionRow = typeof connections.$inferSelect;

export const PROBLEM_STATUSES = ['open', 'acknowledged', 'resolved', 'closed'] as const;
export const PROBLEM_SEVERITIES = ['critical', 'warning', 'info'] as const;
export const SUBJECT_TYPES = ['service', 'resource', 'cluster', 'error_group', 'synthetic', 'integration'] as const;
export const EVIDENCE_KINDS = ['metric', 'event', 'log', 'check', 'inventory'] as const;

export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];
export type ProblemSeverity = (typeof PROBLEM_SEVERITIES)[number];
export type SubjectType = (typeof SUBJECT_TYPES)[number];
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const problems = sqliteTable(
  'problems',
  {
    // The cursor axis of §33.6: AUTOINCREMENT, so a purge never lets SQLite reuse a rowid.
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    id: text('id').notNull().unique(),
    key: text('key').notNull(),
    connectionId: text('connection_id').notNull(),
    scope: text('scope').notNull(),
    kind: text('kind').notNull(),
    subjectType: text('subject_type', { enum: SUBJECT_TYPES }).notNull(),
    subjectId: text('subject_id').notNull(),
    subjectName: text('subject_name').notNull(),
    serviceId: text('service_id'),
    source: text('source').notNull(),
    titleKey: text('title_key').notNull(),
    values: text('values', { mode: 'json' }).$type<Record<string, string | number>>().notNull(),
    severity: text('severity', { enum: PROBLEM_SEVERITIES }).notNull(),
    score: integer('score').notNull(),
    scoreTerms: text('score_terms', { mode: 'json' }).$type<StoredScoreTerms>().notNull(),
    status: text('status', { enum: PROBLEM_STATUSES }).notNull(),
    href: text('href').notNull(),
    firstSeenAt: integer('first_seen_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    lastEvaluatedAt: integer('last_evaluated_at').notNull(),
    clearStreak: integer('clear_streak').notNull().default(0),
    clearSinceAt: integer('clear_since_at'),
    occurrences: integer('occurrences').notNull().default(1),
    flapCount: integer('flap_count').notNull().default(0),
    acknowledgedBy: text('acknowledged_by'),
    acknowledgedAt: integer('acknowledged_at'),
    resolvedAt: integer('resolved_at'),
    investigationId: text('investigation_id'),
    incidentId: text('incident_id'),
    previousProblemId: text('previous_problem_id'),
    fleetProblemId: text('fleet_problem_id'),
    grouped: integer('grouped', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    // One live row per dedupe key. A resolved row leaves the index, so a new row may take its place.
    uniqueIndex('problems_open_key').on(t.key).where(sql`resolved_at is null`),
    index('problems_env_seq').on(t.connectionId, t.scope, t.seq),
    index('problems_key_resolved').on(t.key, t.resolvedAt),
    index('problems_service').on(t.serviceId, t.seq),
  ],
);

export const problemEvidence = sqliteTable(
  'problem_evidence',
  {
    id: text('id').primaryKey(),
    problemId: text('problem_id').notNull().references(() => problems.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    kind: text('kind', { enum: EVIDENCE_KINDS }).notNull(),
    labelKey: text('label_key').notNull(),
    values: text('values', { mode: 'json' }).$type<Record<string, string | number>>().notNull(),
    // null is "not measured" (§2.4). It is never written as 0.
    value: real('value'),
    unit: text('unit'),
    at: integer('at').notNull(),
    seriesRef: text('series_ref'),
    href: text('href'),
  },
  (t) => [index('problem_evidence_problem').on(t.problemId, t.position)],
);

export type ProblemRow = typeof problems.$inferSelect;
export type ProblemEvidenceRow = typeof problemEvidence.$inferSelect;
/** Written by Task 5's scoreProblem; stored verbatim so the page can render the arithmetic it used. */
export type StoredScoreTerms = {
  s: number; b: number | null; t: number; u: number | null; d: number;
  weights: { s: number; b: number; t: number; u: number; d: number };
  availableWeight: number; rescaled: boolean; floored: boolean; score: number;
};

export const EVENT_KINDS = [
  'problem_opened', 'problem_reopened', 'problem_acknowledged', 'problem_resolved',
  'problem_grouped', 'problem_ungrouped', 'fleet_opened', 'fleet_resolved',
  'resource_appeared', 'resource_disappeared', 'error_group_appeared', 'error_group_regressed',
  'collector_job_capped', 'collector_job_failed',
  'deployment_started', 'deployment_completed', 'deployment_failed',
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

export const events = sqliteTable('events', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  id: text('id').notNull().unique(),
  at: integer('at').notNull(),
  connectionId: text('connection_id'),
  scope: text('scope'),
  kind: text('kind', { enum: EVENT_KINDS }).notNull(),
  subjectType: text('subject_type', { enum: SUBJECT_TYPES }).notNull(),
  subjectId: text('subject_id').notNull(),
  serviceId: text('service_id'),
  severity: text('severity', { enum: PROBLEM_SEVERITIES }),
  source: text('source').notNull(),
  payload: text('payload', { mode: 'json' }).$type<Record<string, string | number | null>>().notNull(),
  dedupeKey: text('dedupe_key'),
}, (t) => [
  index('events_at').on(t.at),
  index('events_service_at').on(t.serviceId, t.at),
  index('events_subject_at').on(t.subjectId, t.at),
  uniqueIndex('events_dedupe').on(t.dedupeKey).where(sql`dedupe_key is not null`),
]);

/**
 * What a user chose for themselves (§12's `userPreferences`).
 *
 * One row per administrator, keyed by the user rather than by the instance, because these belong to the
 * person: a viewer changing what they want to be told about must not change anything anybody else sees.
 */
export const userPreferences = sqliteTable('user_preferences', {
  adminUserId: integer('admin_user_id')
    .primaryKey()
    .references(() => adminUser.id, { onDelete: 'cascade' }),
  locale: text('locale'),
  defaultEnvironmentId: text('default_environment_id'),
  /** `critical` | `warning` | `info`: the floor, not a list. */
  minSeverity: text('min_severity', { enum: PROBLEM_SEVERITIES }).notNull().default('critical'),
  categories: text('categories', { mode: 'json' }).$type<string[]>().notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type UserPreferencesRow = typeof userPreferences.$inferSelect;

export const AUDIT_ACTOR_KINDS = ['user', 'system'] as const;
export const AUDIT_RESULTS = ['ok', 'denied', 'failed'] as const;

/**
 * The administrative audit log (§21).
 *
 * **Append-only.** No code path updates or deletes a row — not even the retention purge, which writes its
 * own entry rather than quietly removing others. A log somebody can edit is not evidence, and the only way
 * to be sure of that is for there to be no update or delete statement against this table anywhere.
 *
 * `userAgentHash` rather than the user agent: enough to tell two devices apart, not enough to fingerprint
 * one. The `details` blob never carries a credential, a token or the content of an AI question.
 */
export const auditLog = sqliteTable(
  'audit_log',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    id: text('id').notNull().unique(),
    at: integer('at').notNull(),
    /** Null for `system`, which is what a collector or a scheduled purge acts as. */
    actorUserId: integer('actor_user_id'),
    actorKind: text('actor_kind', { enum: AUDIT_ACTOR_KINDS }).notNull(),
    action: text('action').notNull(),
    subjectType: text('subject_type'),
    subjectId: text('subject_id'),
    result: text('result', { enum: AUDIT_RESULTS }).notNull(),
    ip: text('ip'),
    userAgentHash: text('user_agent_hash'),
    details: text('details', { mode: 'json' }).$type<Record<string, string | number | boolean>>().notNull(),
  },
  (t) => [index('audit_log_at').on(t.at), index('audit_log_action').on(t.action, t.at)],
);

export type AuditLogRow = typeof auditLog.$inferSelect;

export const ALERT_CONDITIONS = ['problem', 'synthetic', 'slo'] as const;
export const ALERT_CHANNELS = ['in_app'] as const;

/**
 * An alert rule (§15.1).
 *
 * `channels` is `in_app` and nothing else in this build. §15 is explicit that nothing leaves the instance
 * until a notifier exists, so installing OpsWatch never surprises anybody's inbox — and the way to keep
 * that promise is for there to be no other channel to choose.
 */
export const alertRules = sqliteTable(
  'alert_rules',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id').notNull(),
    scope: text('scope').notNull(),
    name: text('name').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    condition: text('condition', { enum: ALERT_CONDITIONS }).notNull(),
    minSeverity: text('min_severity', { enum: PROBLEM_SEVERITIES }).notNull().default('critical'),
    /** Detector kinds this rule cares about; empty means every kind of the condition. */
    kinds: text('kinds', { mode: 'json' }).$type<string[]>().notNull(),
    channels: text('channels', { mode: 'json' }).$type<string[]>().notNull(),
    cooldownSeconds: integer('cooldown_seconds').notNull().default(1800),
    /** `auto` rules are created at install, visible and editable — never hidden (§15.1). */
    origin: text('origin', { enum: ['auto', 'user'] as const }).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('alert_rules_name').on(t.connectionId, t.scope, t.name)],
);

export const ALERT_STATUSES = ['firing', 'acknowledged', 'resolved'] as const;

/**
 * One alert (§15.2).
 *
 * `dedupeKey` is `ruleId | subject`, and one open alert exists per key — a second fire updates
 * `lastFiredAt` rather than adding a row, which is what stops one flapping problem becoming forty alerts.
 * `suppressedCount` records the fires that happened inside the cooldown, so the silence is **visible**
 * rather than merely quiet.
 */
/** §15's delivery: where an alert is sent, and what happened when it was. */
export const NOTIFY_KINDS = ['webhook'] as const;
export const NOTIFY_RESULTS = ['ok', 'failed'] as const;

/**
 * A place OpsWatch may send an alert.
 *
 * The signing secret is encrypted like every other credential and is shown to the operator exactly once,
 * when the destination is created. A secret a page can re-read is a secret a page can leak.
 */
export const notifyDestinations = sqliteTable('notify_destinations', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: NOTIFY_KINDS }).notNull(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  secretCiphertext: text('secret_ciphertext').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
  /** What happened last time, so a destination that has quietly stopped working is visible. */
  lastResult: text('last_result', { enum: NOTIFY_RESULTS }),
  lastAttemptAt: integer('last_attempt_at'),
  lastError: text('last_error'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
});

/**
 * One attempt to deliver one alert, kept so a retry has somewhere to stand and a failure is not silent.
 *
 * `nextAttemptAt` is the whole retry policy: the notify job picks up anything due, and a delivery that
 * has exhausted its attempts stays in the table as a failure rather than disappearing.
 */
export const notifyDeliveries = sqliteTable('notify_deliveries', {
  id: text('id').primaryKey(),
  destinationId: text('destination_id').notNull().references(() => notifyDestinations.id, { onDelete: 'cascade' }),
  alertId: text('alert_id').notNull(),
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  attempts: integer('attempts').notNull().default(0),
  status: text('status', { enum: ['pending', 'ok', 'failed'] }).notNull().default('pending'),
  lastError: text('last_error'),
  createdAt: integer('created_at').notNull(),
  nextAttemptAt: integer('next_attempt_at'),
  deliveredAt: integer('delivered_at'),
});

export const alerts = sqliteTable(
  'alerts',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    id: text('id').notNull().unique(),
    connectionId: text('connection_id').notNull(),
    scope: text('scope').notNull(),
    ruleId: text('rule_id').notNull().references(() => alertRules.id, { onDelete: 'cascade' }),
    dedupeKey: text('dedupe_key').notNull(),
    problemId: text('problem_id'),
    titleKey: text('title_key').notNull(),
    values: text('values', { mode: 'json' }).$type<Record<string, string | number>>().notNull(),
    severity: text('severity', { enum: PROBLEM_SEVERITIES }).notNull(),
    status: text('status', { enum: ALERT_STATUSES }).notNull(),
    firstFiredAt: integer('first_fired_at').notNull(),
    lastFiredAt: integer('last_fired_at').notNull(),
    /** Fires that happened inside the cooldown and sent nothing. Shown, so the quiet is accounted for. */
    suppressedCount: integer('suppressed_count').notNull().default(0),
    acknowledgedAt: integer('acknowledged_at'),
    acknowledgedBy: text('acknowledged_by'),
    resolvedAt: integer('resolved_at'),
  },
  (t) => [
    uniqueIndex('alerts_open_dedupe').on(t.dedupeKey).where(sql`resolved_at is null`),
    index('alerts_env_seq').on(t.connectionId, t.scope, t.seq),
  ],
);

export type AlertRuleRow = typeof alertRules.$inferSelect;
export type AlertRow = typeof alerts.$inferSelect;
export type NotifyDestinationRow = typeof notifyDestinations.$inferSelect;
export type NotifyDeliveryRow = typeof notifyDeliveries.$inferSelect;

export const SYNTHETIC_METHODS = ['GET', 'HEAD', 'POST'] as const;

/**
 * A synthetic check an operator declared (§14).
 *
 * `secretHeaders` is encrypted, because a health endpoint's API key is exactly the sort of thing that ends
 * up here. It is never returned by a read path and never rendered — the same treatment as an integration
 * credential, for the same reason.
 */
export const syntheticChecks = sqliteTable(
  'synthetic_checks',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id').notNull(),
    scope: text('scope').notNull(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    method: text('method', { enum: SYNTHETIC_METHODS }).notNull().default('GET'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    /** Assertions as declared, which `lib/detect/synthetic.ts` evaluates. */
    assertions: text('assertions', { mode: 'json' }).$type<unknown[]>().notNull(),
    /** Encrypted. A read path returns whether there are any, never what they are. */
    secretHeadersCiphertext: text('secret_headers_ciphertext'),
    /** Milliseconds; null means nobody set a latency expectation, so the check is never "slow". */
    latencyThresholdMs: integer('latency_threshold_ms'),
    intervalMinutes: integer('interval_minutes').notNull().default(5),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('synthetic_checks_name').on(t.connectionId, t.scope, t.name)],
);

/** One run of one check. Kept so §14's rules can read a history rather than a last value. */
export const syntheticRuns = sqliteTable(
  'synthetic_runs',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    id: text('id').notNull().unique(),
    checkId: text('check_id')
      .notNull()
      .references(() => syntheticChecks.id, { onDelete: 'cascade' }),
    at: integer('at').notNull(),
    ok: integer('ok', { mode: 'boolean' }).notNull(),
    status: integer('status'),
    /** Null when the run never got far enough to measure one, which is not the same as instant. */
    totalMs: integer('total_ms'),
    dnsMs: integer('dns_ms'),
    tlsMs: integer('tls_ms'),
    ttfbMs: integer('ttfb_ms'),
    bodyBytes: integer('body_bytes'),
    certificateExpiresAt: integer('certificate_expires_at'),
    /** Why it failed, as a key rather than a sentence. Never the response body. */
    failureReason: text('failure_reason'),
    assertionResults: text('assertion_results', { mode: 'json' }).$type<unknown[]>().notNull(),
  },
  (t) => [index('synthetic_runs_check_at').on(t.checkId, t.at)],
);

export type SyntheticCheckRow = typeof syntheticChecks.$inferSelect;
export type SyntheticRunRow = typeof syntheticRuns.$inferSelect;

/**
 * The external services OpsWatch can be connected to, besides AWS.
 *
 * AWS is not here: it has its own `connections` table because an AWS connection carries a region set, a
 * role ARN, an external id and a permission report, none of which a generic integration row has room for.
 * Everything else is one credential and a status, which is exactly what this table holds.
 */
export const INTEGRATION_KINDS = ['github', 'ai', 'cloudflare'] as const;
export const INTEGRATION_STATUSES = ['configured', 'untested', 'failed'] as const;

/**
 * External providers beyond AWS (§13, §20). Stage 4's `provider_connections` becomes this table, so
 * Cloudflare and GitHub are rows of one kind rather than two parallel designs.
 *
 * The credential is encrypted with a purpose-scoped key and is **write-only**: no read path returns it, and
 * no page renders it. §13's rule that repository analysis never modifies anything starts here — the token
 * is asked for with read scopes, and the client that uses it has no write verb.
 */
export const integrations = sqliteTable(
  'integrations',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: INTEGRATION_KINDS }).notNull(),
    name: text('name').notNull(),
    /** Encrypted at rest. Null while an integration is declared but not yet given a credential. */
    credentialCiphertext: text('credential_ciphertext'),
    /**
     * Everything about the connection that is **not** a secret: which model, which account, which zones.
     * Kept out of the ciphertext on purpose — a page has to be able to say what is connected without
     * decrypting anything, and a value nobody needs to hide should not be behind a key.
     */
    config: text('config', { mode: 'json' }).$type<Record<string, unknown>>(),
    status: text('status', { enum: INTEGRATION_STATUSES }).notNull().default('untested'),
    lastTestedAt: integer('last_tested_at'),
    lastError: text('last_error'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('integrations_kind_name').on(t.kind, t.name)],
);

/**
 * A repository an operator has told OpsWatch about.
 *
 * Recorded independently of a credential: knowing that `owner/name` exists and which branch is default is
 * enough to build a link and to resolve a stack frame to a path. Reading the file at that path needs a
 * token, and the page says which of the two it has (§13).
 */
export const repositories = sqliteTable(
  'repositories',
  {
    id: text('id').primaryKey(),
    integrationId: text('integration_id').references(() => integrations.id, { onDelete: 'set null' }),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    defaultBranch: text('default_branch').notNull().default('main'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('repositories_owner_name').on(t.owner, t.name)],
);

/**
 * Which repository a service's code lives in (§13's `service_repositories`).
 *
 * **Declared by a user.** OpsWatch may suggest a match from an image or repository name, and never applies
 * one automatically — a wrong mapping sends an operator to the wrong diff during an incident, which is worse
 * than having no mapping at all. `source` records which it was, so a suggestion accepted by a person is
 * distinguishable from one nobody ever looked at.
 */
export const SERVICE_REPOSITORY_SOURCES = ['declared', 'suggested'] as const;

export const serviceRepositories = sqliteTable(
  'service_repositories',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id').notNull(),
    scope: text('scope').notNull(),
    serviceId: text('service_id').notNull(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    /** Where the service's code sits inside the repository, for a monorepo. */
    pathPrefix: text('path_prefix'),
    source: text('source', { enum: SERVICE_REPOSITORY_SOURCES }).notNull().default('declared'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('service_repositories_service').on(t.connectionId, t.scope, t.serviceId)],
);

export type IntegrationRow = typeof integrations.$inferSelect;
export type RepositoryRow = typeof repositories.$inferSelect;
export type ServiceRepositoryRow = typeof serviceRepositories.$inferSelect;

export const DEPLOYMENT_STATUSES = ['in_progress', 'completed', 'failed', 'rolled_back', 'unknown'] as const;

/**
 * Deployments, as the collector observes them (DEP-1).
 *
 * Identified by the provider's own deployment id, so a cycle that sees the same deployment again updates
 * the row rather than adding a second one — the same reasoning as a problem's dedupe key.
 */
export const deployments = sqliteTable(
  'deployments',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    id: text('id').notNull().unique(),
    connectionId: text('connection_id').notNull(),
    scope: text('scope').notNull(),
    /** The provider's id for this deployment, unique within an environment. */
    deploymentId: text('deployment_id').notNull(),
    serviceId: text('service_id').notNull(),
    serviceName: text('service_name').notNull(),
    cluster: text('cluster').notNull(),
    /** The task definition revision, which is the version a reader recognises. */
    taskDefinition: text('task_definition').notNull(),
    status: text('status', { enum: DEPLOYMENT_STATUSES }).notNull(),
    startedAt: integer('started_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    desiredCount: integer('desired_count').notNull(),
    runningCount: integer('running_count').notNull(),
    failedTasks: integer('failed_tasks').notNull(),
    firstSeenAt: integer('first_seen_at').notNull(),
  },
  (t) => [
    uniqueIndex('deployments_provider_id').on(t.connectionId, t.scope, t.deploymentId),
    index('deployments_env_started').on(t.connectionId, t.scope, t.startedAt),
    index('deployments_service').on(t.serviceId, t.startedAt),
  ],
);

export type DeploymentRow = typeof deployments.$inferSelect;
export type StoredDeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

export const COLLECTOR_RUN_STATUSES = ['running', 'ok', 'failed', 'skipped'] as const;

export const collectorRuns = sqliteTable('collector_runs', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  id: text('id').notNull().unique(),
  job: text('job').notNull(),
  connectionId: text('connection_id'),
  scope: text('scope'),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  status: text('status', { enum: COLLECTOR_RUN_STATUSES }).notNull(),
  covered: integer('covered'),
  total: integer('total'),
  truncated: integer('truncated', { mode: 'boolean' }).notNull().default(false),
  errorCode: text('error_code'),
}, (t) => [index('collector_runs_job').on(t.job, t.startedAt)]);

export type EventRow = typeof events.$inferSelect;
export type CollectorRunRow = typeof collectorRuns.$inferSelect;

/** Exactly one row, id = 1. Seeded by the first claim, never by a migration. */
export const collectorLock = sqliteTable('collector_lock', {
  id: integer('id').primaryKey(),
  owner: text('owner').notNull(),
  heartbeatAt: integer('heartbeat_at').notNull(),
});
export type CollectorLockRow = typeof collectorLock.$inferSelect;

export const INCIDENT_STATUSES = ['investigating', 'identified', 'monitoring', 'resolved'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const incidents = sqliteTable('incidents', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  id: text('id').notNull().unique(),
  connectionId: text('connection_id').notNull(),
  scope: text('scope').notNull(),
  titleKey: text('title_key').notNull(),
  values: text('values', { mode: 'json' }).$type<Record<string, string | number>>().notNull(),
  status: text('status', { enum: INCIDENT_STATUSES }).notNull(),
  severity: text('severity', { enum: PROBLEM_SEVERITIES }).notNull(),
  startedAt: integer('started_at').notNull(),
  resolvedAt: integer('resolved_at'),
  serviceIds: text('service_ids', { mode: 'json' }).$type<string[]>().notNull(),
  origin: text('origin', { enum: ['auto', 'user'] as const }).notNull(),
  dismissedAt: integer('dismissed_at'),
}, (t) => [index('incidents_env_seq').on(t.connectionId, t.scope, t.seq)]);

export const INCIDENT_TIMELINE_KINDS = ['status_change', 'event', 'note'] as const;
export type IncidentTimelineKind = (typeof INCIDENT_TIMELINE_KINDS)[number];

export const incidentTimeline = sqliteTable('incident_timeline', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  id: text('id').notNull().unique(),
  incidentId: text('incident_id').notNull().references(() => incidents.id, { onDelete: 'cascade' }),
  at: integer('at').notNull(),
  kind: text('kind', { enum: INCIDENT_TIMELINE_KINDS }).notNull(),
  eventId: text('event_id'),
  actorId: text('actor_id'),
  messageKey: text('message_key'),
  values: text('values', { mode: 'json' }).$type<Record<string, string | number>>().notNull(),
  note: text('note'),
}, (t) => [index('incident_timeline_incident').on(t.incidentId, t.at)]);

export type IncidentRow = typeof incidents.$inferSelect;
export type IncidentTimelineRow = typeof incidentTimeline.$inferSelect;

export const FAMILY_STATUSES = ['healthy', 'degraded', 'critical', 'unknown'] as const;
export type FamilyStatus = (typeof FAMILY_STATUSES)[number];

/**
 * What the last detect cycle saw of one family of one environment.
 *
 * Health has to be instant and must cost nothing, so it reads this rather than AWS. The detect job already
 * fetches all four families every five minutes and already knows how many resources each has and how many are
 * affected; this is where it writes that down. Without it Health could only report `null` for every count -
 * permitted by the contract, useless to a reader.
 *
 * One row per family per environment, replaced each cycle: it is a snapshot, not a history. History is what
 * the events spine is for.
 */
export const familySnapshots = sqliteTable(
  'family_snapshots',
  {
    connectionId: text('connection_id').notNull(),
    scope: text('scope').notNull(),
    family: text('family').notNull(),
    status: text('status', { enum: FAMILY_STATUSES }).notNull(),
    /** Null when the family could not be read: "not measured" is never written as 0 (§2.4). */
    total: integer('total'),
    affected: integer('affected'),
    readAt: integer('read_at').notNull(),
    /** Why it could not be read, for logic. The sentence a reader sees is built from these at read time. */
    unavailableReason: text('unavailable_reason'),
    unavailableCode: text('unavailable_code'),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.scope, t.family] })],
);

export type FamilySnapshotRow = typeof familySnapshots.$inferSelect;

export const ERROR_GROUP_STATUSES = ['new', 'regressed', 'ongoing', 'resolved', 'muted'] as const;
export type ErrorGroupStatus = (typeof ERROR_GROUP_STATUSES)[number];

/**
 * An error group (§4.4): a fingerprint, not an occurrence. It is what a screen lists, counts and follows.
 *
 * `fingerprintVersion` is stored on every row so that changing the algorithm bumps the version and produces
 * new groups rather than silently re-merging history — the group page can then say "regrouped in version N"
 * when both exist.
 */
export const errorGroups = sqliteTable(
  'error_groups',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    id: text('id').notNull().unique(),
    fingerprint: text('fingerprint').notNull(),
    fingerprintVersion: integer('fingerprint_version').notNull(),
    connectionId: text('connection_id').notNull(),
    scope: text('scope').notNull(),
    serviceId: text('service_id'),
    logSourceId: text('log_source_id').notNull(),
    exceptionType: text('exception_type'),
    /** One real message, kept so a reader sees what it actually looked like. */
    sampleMessage: text('sample_message').notNull(),
    /** What the fingerprint was computed over. Stored so a regrouping can be explained. */
    normalizedMessage: text('normalized_message').notNull(),
    topFrames: text('top_frames', { mode: 'json' }).$type<string[]>().notNull(),
    /**
     * Where the **most recent sighting** was, with line numbers (REPO-5).
     *
     * A sample, not an identity. `topFrames` is normalised and is what the group is about; this is the raw
     * location of one occurrence, overwritten each time the group is seen. The distinction is the whole
     * point: §4.4 groups on the file and the function so that adding a blank line does not split a group
     * in two, and a reader still wants to know which line to open. Two questions, two columns.
     *
     * Null for a group last seen before this column existed, or one whose stack carried no line.
     */
    sampleFrames: text('sample_frames', { mode: 'json' }).$type<{ file: string; function: string | null; line: number | null; column: number | null }[]>(),
    firstSeenAt: integer('first_seen_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    status: text('status', { enum: ERROR_GROUP_STATUSES }).notNull(),
    /** When it entered its current status. For a regression this is when it came back, not when it began. */
    statusSince: integer('status_since').notNull(),
    lastDeploymentId: text('last_deployment_id'),
    problemId: text('problem_id'),
    mutedReason: text('muted_reason'),
  },
  (t) => [
    // One group per fingerprint per environment, per algorithm version.
    uniqueIndex('error_groups_fingerprint').on(t.connectionId, t.scope, t.fingerprint, t.fingerprintVersion),
    index('error_groups_env_seq').on(t.connectionId, t.scope, t.seq),
    index('error_groups_last_seen').on(t.connectionId, t.scope, t.lastSeenAt),
  ],
);

/**
 * Occurrences, rolled up by hour. §4.4 counts over a window, and an hourly bucket is what makes "three times
 * the baseline for this hour of the week" answerable without keeping every line.
 */
export const errorOccurrences = sqliteTable(
  'error_occurrences',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => errorGroups.id, { onDelete: 'cascade' }),
    /** The hour this bucket covers, as epoch milliseconds truncated to the hour. */
    hourAt: integer('hour_at').notNull(),
    count: integer('count').notNull(),
    /** How many distinct instances reported it in that hour. Null when the source does not say. */
    instances: integer('instances'),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.hourAt] })],
);

/**
 * A log group OpsWatch may read errors from, and how to parse it.
 *
 * **Opt-in per source, off by default**, because Logs Insights is billed per gigabyte scanned and is the one
 * cost that can surprise (§9.5). A disabled source costs nothing at all. The field *mapping* is stored here;
 * the log content is not.
 */
export const logSources = sqliteTable(
  'log_sources',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id').notNull(),
    scope: text('scope').notNull(),
    logGroup: text('log_group').notNull(),
    serviceId: text('service_id'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    format: text('format', { enum: ['json', 'regex'] as const }).notNull(),
    /** Which field holds the level, the type, the message, the stack, the route. Never the content itself. */
    fieldMap: text('field_map', { mode: 'json' }).$type<Record<string, string>>().notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('log_sources_group').on(t.connectionId, t.scope, t.logGroup)],
);

/**
 * Where a reader had got to. "What's new" is measured against the last time *you* looked, not against a
 * fixed window, which is what makes a morning brief personal rather than generic.
 */
export const userMarks = sqliteTable(
  'user_marks',
  {
    adminUserId: integer('admin_user_id')
      .notNull()
      .references(() => adminUser.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    connectionId: text('connection_id').notNull(),
    scope: text('scope').notNull(),
    seenAt: integer('seen_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.adminUserId, t.kind, t.connectionId, t.scope] })],
);

export type ErrorGroupRow = typeof errorGroups.$inferSelect;
export type ErrorOccurrenceRow = typeof errorOccurrences.$inferSelect;
export type LogSourceRow = typeof logSources.$inferSelect;

/**
 * How many bytes Logs Insights scanned, per day, for the whole instance.
 *
 * §9.5: Logs Insights is billed per gigabyte scanned and is the one cost that can surprise a self-hoster.
 * `OPSWATCH_LOGS_BUDGET_GB_PER_DAY` is a **hard stop**, not a warning, and this is what it is measured
 * against. One row per UTC day, so yesterday's spend is still readable tomorrow.
 */
export const logsUsage = sqliteTable(
  'logs_usage',
  {
    /** The UTC day, as epoch milliseconds at midnight. */
    day: integer('day').primaryKey(),
    bytesScanned: integer('bytes_scanned').notNull(),
    queries: integer('queries').notNull(),
    /** Set when the budget stopped the job that day, so the reason is visible rather than inferred. */
    stoppedAt: integer('stopped_at'),
  },
);

export type LogsUsageRow = typeof logsUsage.$inferSelect;

/**
 * The default historical store (§33.9's first provider): history in the OpsWatch database itself.
 *
 * The primary key *is* §33.10's idempotency key, which is what makes a replayed batch a no-op rather than a
 * duplicate — the guarantee a crash mid-batch is recovered by.
 */
export const historyPoints = sqliteTable(
  'history_points',
  {
    category: text('category').notNull(),
    connectionId: text('connection_id').notNull(),
    scope: text('scope').notNull(),
    subjectId: text('subject_id').notNull(),
    metric: text('metric').notNull(),
    resolution: text('resolution').notNull(),
    intervalStart: integer('interval_start').notNull(),
    /** Null is "not measured" and is stored as such (§2.4). */
    value: real('value'),
    samples: integer('samples').notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.category, t.connectionId, t.scope, t.subjectId, t.metric, t.resolution, t.intervalStart],
    }),
    index('history_points_range').on(t.connectionId, t.scope, t.subjectId, t.metric, t.resolution, t.intervalStart),
  ],
);

/**
 * How far each series is complete. Read separately from the points, because §33.10 requires a read to carry
 * the watermark even when it returns nothing at all.
 */
export const historyWatermarks = sqliteTable(
  'history_watermarks',
  {
    category: text('category').notNull(),
    connectionId: text('connection_id').notNull(),
    scope: text('scope').notNull(),
    subjectId: text('subject_id').notNull(),
    metric: text('metric').notNull(),
    resolution: text('resolution').notNull(),
    completeTo: integer('complete_to').notNull(),
  },
  (t) => [primaryKey({ columns: [t.category, t.connectionId, t.scope, t.subjectId, t.metric, t.resolution] })],
);

export type HistoryPointRow = typeof historyPoints.$inferSelect;

export const HISTORY_CATEGORIES = [
  'infrastructure',
  'application',
  'database',
  'cache',
  'logs',
  'errors',
  'synthetics',
  'deployments',
  'problems',
  'incidents',
  'alerts',
] as const;
export type HistoryCategoryId = (typeof HISTORY_CATEGORIES)[number];

/**
 * Historical collection settings (§31.1). One row, id = 1, like the other settings.
 *
 * **Disabled by default, and that is the owner's binding ruling**: a fresh installation must never add AWS
 * polling cost without an explicit action. While it is off there is no recurring polling at all and every
 * live page keeps working exactly as it does today.
 */
export const historySettings = sqliteTable('history_settings', {
  id: integer('id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  /** Minutes between cycles when enabled. No hardcoded default beyond the form's initial suggestion. */
  intervalMinutes: integer('interval_minutes').notNull().default(5),
  /** Which categories are collected. Granular, because paying for all of them to get one is not a choice. */
  categories: text('categories', { mode: 'json' }).$type<HistoryCategoryId[]>().notNull(),
  /** How long history is kept, in days. */
  retentionDays: integer('retention_days').notNull().default(90),
  /** Which provider stores it. `opswatch-db` is the default and the only one this phase ships. */
  providerId: text('provider_id').notNull().default('opswatch-db'),
  updatedAt: integer('updated_at').notNull(),
});

export type HistorySettingsRow = typeof historySettings.$inferSelect;


/** What an objective is measured on (§19). Availability reads request counts; latency reads stored p95s. */
export const SLO_KINDS = ['availability', 'latency'] as const;
export type SloKind = (typeof SLO_KINDS)[number];

/**
 * One service level objective, as an operator defined it (§19).
 *
 * Definitions are the thing that was missing: the arithmetic and the rollups already existed, so every
 * availability figure was measured against one hard-wired 99.9 %. An objective is a **decision about a
 * particular service** — a batch worker and a checkout API do not deserve the same number — and until it
 * can be written down, the figure is the tool's opinion rather than the operator's target.
 *
 * `subjectId` is the id the rollups are stored under, so a definition points at a series that exists rather
 * than at a name somebody typed. Nothing here stores a measurement: every figure is computed from history
 * on read, which is what keeps a definition free to change without rewriting the past.
 */
export const sloDefinitions = sqliteTable(
  'slo_definitions',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id').notNull(),
    scope: text('scope').notNull(),
    name: text('name').notNull(),
    kind: text('kind', { enum: SLO_KINDS }).notNull(),
    /** The history subject this is measured on — a load balancer, as the metrics job stores it. */
    subjectId: text('subject_id').notNull(),
    /** A fraction: 0.999 is 99.9 %. Stored as written, never rounded for display. */
    objective: real('objective').notNull(),
    /** Milliseconds, for a latency objective. Null for an availability one, where it means nothing. */
    latencyThresholdMs: integer('latency_threshold_ms'),
    /** The window the objective is measured over, in days. */
    windowDays: integer('window_days').notNull().default(30),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('slo_definitions_name').on(t.connectionId, t.scope, t.name)],
);

export type SloDefinitionRow = typeof sloDefinitions.$inferSelect;

/**
 * Which install rules an environment has already been offered (§15.1).
 *
 * `ensureInstallRules` never revives a rule somebody deleted on purpose, and until this existed the only
 * way to keep that promise was to act once, when the environment had no rules at all — which meant an
 * installation that had been running for a week could never receive a rule a later release shipped. The
 * offer is what separates the two cases: a name that has been offered is never created again, and a name
 * that has not is created once. Deleting a rule still keeps it deleted.
 */
export const installRuleOffers = sqliteTable(
  'install_rule_offers',
  {
    connectionId: text('connection_id').notNull(),
    scope: text('scope').notNull(),
    name: text('name').notNull(),
    offeredAt: integer('offered_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.scope, t.name] })],
);

/**
 * §8's baselines: what one series normally reads at one hour of the week.
 *
 * One row per `(environment, subject, metric, bucket)`, recomputed by the `baselines` job from the rollups
 * already stored. Nothing here is a measurement of now — it is a summary of the past, kept so that
 * "is this unusual?" can be answered without re-reading weeks of history on every page load.
 *
 * `mad` may legitimately be zero, for a series that is always the same. That is why it is a column rather
 * than an absence: the arithmetic distinguishes "no spread" from "no baseline", and so must the storage.
 */
export const metricBaselines = sqliteTable(
  'metric_baselines',
  {
    connectionId: text('connection_id').notNull(),
    scope: text('scope').notNull(),
    subjectId: text('subject_id').notNull(),
    metric: text('metric').notNull(),
    /** Hour of the week in UTC, 0–167. */
    bucket: integer('bucket').notNull(),
    median: real('median').notNull(),
    mad: real('mad').notNull(),
    /** How many observations it was computed from, so a thin baseline can be shown as thin. */
    samples: integer('samples').notNull(),
    computedAt: integer('computed_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.scope, t.subjectId, t.metric, t.bucket] })],
);

export type MetricBaselineRow = typeof metricBaselines.$inferSelect;

/**
 * The commits behind one deployment (REPO-4, §J).
 *
 * Written by the deployments job when GitHub is connected and the service is mapped to a repository, so a
 * deployment detail is answered from stored rows rather than by calling GitHub every time somebody opens a
 * page. A deployment with no rows here is a deployment whose commits were never fetched — which is not the
 * same as a deployment with no commits, and the page says which.
 */
export const deploymentCommits = sqliteTable(
  'deployment_commits',
  {
    deploymentId: text('deployment_id').notNull(),
    sha: text('sha').notNull(),
    repository: text('repository').notNull(),
    /** The summary line only. A commit body is prose, and a timeline shows a line. */
    message: text('message').notNull(),
    author: text('author'),
    at: integer('at').notNull(),
    /** Changed files, as the provider reported them. Paths and counts — never file contents. */
    files: text('files', { mode: 'json' }).$type<{ path: string; additions: number; deletions: number; status: string }[]>().notNull(),
    fetchedAt: integer('fetched_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.deploymentId, t.sha] }), index('deployment_commits_at').on(t.deploymentId, t.at)],
);

export type DeploymentCommitRow = typeof deploymentCommits.$inferSelect;

/**
 * One day of one Cloudflare zone, as their analytics API reports it (CF-2).
 *
 * Stored rather than fetched on view, for the same reason every other surface reads rows: a page must be
 * cheap, repeatable and answerable when the provider is unreachable. The grain is a day because that is
 * the grain `httpRequests1dGroups` gives on the plans most operators have — asking for an hourly series a
 * free zone cannot serve would produce a chart that is empty for some and full for others.
 *
 * Every column is a **count Cloudflare reported**. Nothing here is derived, so a ratio shown on a page can
 * always be recomputed from what is stored and checked.
 */
export const cloudflareDaily = sqliteTable(
  'cloudflare_daily',
  {
    zoneId: text('zone_id').notNull(),
    /** `YYYY-MM-DD` in UTC, as Cloudflare groups it. */
    date: text('date').notNull(),
    requests: integer('requests').notNull(),
    cachedRequests: integer('cached_requests').notNull(),
    bytes: integer('bytes').notNull(),
    cachedBytes: integer('cached_bytes').notNull(),
    /** Requests Cloudflare's security products acted on. */
    threats: integer('threats').notNull(),
    /** Unique visitors, as Cloudflare counts them. Null where the plan does not report it. */
    uniques: integer('uniques'),
    /** Edge responses in the 4xx and 5xx ranges, summed from the status map. */
    clientErrors: integer('client_errors').notNull(),
    serverErrors: integer('server_errors').notNull(),
    fetchedAt: integer('fetched_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.zoneId, t.date] })],
);

export type CloudflareDailyRow = typeof cloudflareDaily.$inferSelect;

/**
 * One person's saved log searches.
 *
 * Keyed by the user, like `user_preferences` and `user_marks`: two operators looking at the same
 * environment keep different lists, and the foreign key makes that structural rather than a rule the read
 * path has to remember. Nothing here is shared with anybody, published, or sent anywhere.
 *
 * Only a **relative** range is stored (`1h`, `24h`). An absolute window would make a saved search a
 * bookmark to a moment that never comes back.
 */
export const savedLogSearches = sqliteTable(
  'saved_log_searches',
  {
    id: text('id').primaryKey(),
    adminUserId: integer('admin_user_id')
      .notNull()
      .references(() => adminUser.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id').notNull(),
    scope: text('scope').notNull(),
    name: text('name').notNull(),
    searchText: text('search_text').notNull(),
    level: text('level'),
    limitRows: integer('limit_rows').notNull(),
    range: text('range').notNull(),
    logGroups: text('log_groups', { mode: 'json' }).$type<string[]>().notNull(),
    /** The Logs Insights query when the editor was used; null when the search box built it. */
    query: text('query'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    // One name per person per environment: renaming onto an existing name is refused by the database.
    uniqueIndex('saved_log_searches_name').on(t.adminUserId, t.connectionId, t.scope, t.name),
    index('saved_log_searches_owner').on(t.adminUserId, t.connectionId, t.scope),
  ],
);

export type SavedLogSearchRow = typeof savedLogSearches.$inferSelect;
