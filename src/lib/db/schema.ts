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

