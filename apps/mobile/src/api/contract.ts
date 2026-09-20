/**
 * The OpsWatch API contract, version 1 (`/api/v1`), shared by the server, the web app and this app.
 *
 * TEMPORARY LOCAL COPY. The canonical contract moves to `packages/contract` (owned with the server side, see
 * docs/mobile/api-contract.md). Do not evolve this file on its own: record any change mobile needs in that document
 * and reconcile it with `packages/contract`. Once the package lands on this branch, this file is deleted and imports
 * point at the package.
 *
 * Every response is validated with these schemas at the boundary (src/api/http.ts), so a server that drifts from the
 * contract produces a clear `invalid_response` error instead of a crash deep inside a screen.
 *
 * Rules shared by every schema:
 * - Times are epoch milliseconds.
 * - A metric the server cannot measure is `null`, never `0`. Screens render "No data" for `null`.
 * - Objects are parsed leniently: unknown keys are dropped, and an unknown enum value from a newer server falls back
 *   to a neutral value instead of rejecting the whole response.
 * - Every object that can be acted upon lists the actions the server authorises in `allowedActions`.
 * - No React Native, Node or server-only import, so the file can move to `packages/contract` unchanged.
 */
import { z } from 'zod';

export const API_PREFIX = '/api/v1';
export const API_VERSION = 1;

/** An enum that tolerates values added by a newer server, mapping them to `fallback`. */
function lenientEnum<const T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) {
  return z
    .string()
    .transform((value): T[number] => ((values as readonly string[]).includes(value) ? (value as T[number]) : fallback));
}

const id = z.string().min(1).max(200);
const epoch = z.number().finite();
const nullableNumber = z.number().finite().nullable();
const actions = z.array(z.string()).default([]);

// ---------------------------------------------------------------------------------------------------------------------
// Shared vocabulary

export const SEVERITIES = ['critical', 'warning', 'info'] as const;
export const severitySchema = lenientEnum(SEVERITIES, 'info');
export type Severity = (typeof SEVERITIES)[number];

export const HEALTH_STATUSES = ['healthy', 'degraded', 'critical', 'unknown'] as const;
export const healthStatusSchema = lenientEnum(HEALTH_STATUSES, 'unknown');
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const REF_TYPES = [
  'problem',
  'error',
  'service',
  'alert',
  'incident',
  'synthetic',
  'slo',
  'deployment',
  'infrastructure',
  'investigation',
  'evidence',
  'log',
  'environment',
] as const;
export type RefType = (typeof REF_TYPES)[number];
export const refTypeSchema = z.enum(REF_TYPES);

/** A typed pointer to another OpsWatch object. The app turns it into a route through the deep-link allow-list. */
export const refSchema = z.object({ type: refTypeSchema, id, label: z.string().optional() });
export type Ref = z.infer<typeof refSchema>;

export const METRIC_UNITS = ['percent', 'ms', 'seconds', 'count', 'per_minute', 'per_second', 'bytes', 'ratio', 'none'] as const;
export const metricUnitSchema = lenientEnum(METRIC_UNITS, 'none');
export type MetricUnit = (typeof METRIC_UNITS)[number];

export const metricValueSchema = z.object({
  value: nullableNumber,
  unit: metricUnitSchema,
  status: lenientEnum(['ok', 'warning', 'critical', 'unknown'] as const, 'unknown').nullable().default(null),
});
export type MetricValue = z.infer<typeof metricValueSchema>;

/** A time series as compact `[time, value]` pairs. A `null` value is a gap, not a zero. */
export const seriesSchema = z.object({
  id: z.string().optional(),
  label: z.string(),
  unit: metricUnitSchema,
  points: z.array(z.tuple([epoch, nullableNumber])),
  thresholds: z.object({ warning: z.number().optional(), critical: z.number().optional() }).optional(),
});
export type Series = z.infer<typeof seriesSchema>;

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable().default(null) });
}
export type Page<T> = { items: T[]; nextCursor: string | null };

// ---------------------------------------------------------------------------------------------------------------------
// Server, auth, environments

export const FEATURES = [
  'health',
  'brief',
  'problems',
  'errors',
  'services',
  'infrastructure',
  'logs',
  'alerts',
  'incidents',
  'synthetics',
  'slos',
  'deployments',
  'investigations',
  'repository',
  'ai',
  'search',
  'favorites',
  'environments',
  'push',
] as const;
export type Feature = (typeof FEATURES)[number];

const featureFlags = z
  .record(z.string(), z.boolean())
  .transform((flags) => Object.fromEntries(FEATURES.map((f) => [f, flags[f] === true])) as Record<Feature, boolean>);

export const serverInfoSchema = z.object({
  product: z.literal('opswatch'),
  version: z.string(),
  apiVersion: z.number().int(),
  name: z.string().optional(),
  /** True when the instance answers from fixtures rather than from a real account (the app then shows DEMO DATA). */
  demo: z.boolean().optional().default(false),
  auth: z.object({ password: z.boolean(), google: z.boolean() }),
  features: featureFlags,
});
export type ServerInfo = z.infer<typeof serverInfoSchema>;

export const userSchema = z.object({ email: z.string(), name: z.string().optional() });
export type User = z.infer<typeof userSchema>;

export const authSessionSchema = z.object({ token: z.string().min(16), expiresAt: epoch, user: userSchema });
export type AuthSession = z.infer<typeof authSessionSchema>;

export const ENVIRONMENT_KINDS = ['production', 'staging', 'development', 'custom'] as const;
export type EnvironmentKind = (typeof ENVIRONMENT_KINDS)[number];
export const environmentSchema = z.object({
  id,
  name: z.string(),
  kind: lenientEnum(ENVIRONMENT_KINDS, 'custom'),
  description: z.string().optional(),
});
export type Environment = z.infer<typeof environmentSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Problems, evidence, investigations

export const PROBLEM_STATUSES = ['new', 'active', 'acknowledged', 'resolved'] as const;
export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];
export const TRENDS = ['rising', 'falling', 'stable'] as const;
export type Trend = (typeof TRENDS)[number];
/** Whether something is getting worse. `null` means the server has no trend for it, and never renders as "stable". */
export const trendSchema = lenientEnum(TRENDS, 'stable').nullable().default(null);

export const problemSummarySchema = z.object({
  id,
  title: z.string(),
  severity: severitySchema,
  status: lenientEnum(PROBLEM_STATUSES, 'active'),
  category: z.string(),
  service: refSchema.optional(),
  resource: z.string().optional(),
  firstSeenAt: epoch,
  lastSeenAt: epoch,
  occurrences: nullableNumber.default(null),
  trend: trendSchema,
  summary: z.string().optional(),
});
export type ProblemSummary = z.infer<typeof problemSummarySchema>;

export const EVIDENCE_KINDS = ['fact', 'correlation', 'hypothesis'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const evidenceSchema = z.object({
  id,
  at: epoch,
  /** Observed fact, correlation between facts, or hypothesis. Screens keep the three visibly apart. */
  // An unknown kind from a newer server must never be presented as an observed fact.
  kind: lenientEnum(EVIDENCE_KINDS, 'hypothesis'),
  type: z.string(),
  title: z.string(),
  detail: z.string().optional(),
  ref: refSchema.optional(),
  series: seriesSchema.optional(),
  confidence: lenientEnum(['low', 'medium', 'high'] as const, 'low').optional(),
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const DEPLOYMENT_STATUSES = ['in_progress', 'completed', 'failed', 'rolled_back', 'unknown'] as const;
export const commitSchema = z.object({
  sha: z.string(),
  message: z.string().optional(),
  author: z.string().optional(),
  at: epoch.optional(),
  /** Built by the server, which alone knows the provider and the host. Absent means it cannot build one. */
  url: z.string().optional(),
});
export const deploymentSummarySchema = z.object({
  id,
  service: refSchema,
  environment: z.string().optional(),
  version: z.string(),
  at: epoch,
  status: lenientEnum(DEPLOYMENT_STATUSES, 'unknown'),
  commit: commitSchema.optional(),
  repository: z.string().optional(),
});
export type DeploymentSummary = z.infer<typeof deploymentSummarySchema>;

export const repositoryEvidenceSchema = z.object({
  id,
  repository: z.string(),
  branch: z.string().optional(),
  commit: commitSchema,
  file: z.string().optional(),
  lines: z.object({ start: z.number().int(), end: z.number().int() }).optional(),
  snippet: z
    .object({ startLine: z.number().int(), code: z.array(z.string()), highlight: z.array(z.number().int()).default([]) })
    .optional(),
  /** Unified diff text, already trimmed by the server to the relevant hunks. */
  diff: z.string().optional(),
  /** Link to the file at this commit, built by the server. */
  fileUrl: z.string().optional(),
  summary: z.string().optional(),
});
export type RepositoryEvidence = z.infer<typeof repositoryEvidenceSchema>;

export const errorSummarySchema = z.object({
  id,
  message: z.string(),
  type: z.string().optional(),
  status: lenientEnum(['new', 'recurring', 'regression', 'resolved'] as const, 'recurring'),
  service: refSchema.optional(),
  route: z.string().optional(),
  occurrences: nullableNumber.default(null),
  affectedInstances: nullableNumber.default(null),
  /** The period `occurrences` and `affectedInstances` cover. `null` means since `firstSeenAt`. */
  occurrencesWindow: z.object({ from: epoch, to: epoch }).nullable().default(null),
  firstSeenAt: epoch,
  lastSeenAt: epoch,
  /** When the current status began: for a regression, when it came back, which `firstSeenAt` cannot say. */
  statusSince: epoch.optional(),
  /** Whether it is getting worse. `null` renders as "no trend", never `stable`. */
  trend: trendSchema,
  problemId: id.optional(),
});
export type ErrorSummary = z.infer<typeof errorSummarySchema>;

export const alertSummarySchema = z.object({
  id,
  name: z.string(),
  severity: severitySchema,
  status: lenientEnum(['firing', 'acknowledged', 'resolved', 'insufficient_data'] as const, 'insufficient_data'),
  source: z.string(),
  reason: z.string().optional(),
  since: epoch.nullable(),
  /** When it stopped firing; `null` while it still is. */
  resolvedAt: epoch.nullable().default(null),
  service: refSchema.optional(),
  problemId: id.optional(),
  incidentId: id.optional(),
});
export type AlertSummary = z.infer<typeof alertSummarySchema>;

export const problemDetailSchema = problemSummarySchema.extend({
  description: z.string().optional(),
  evidence: z.array(evidenceSchema).default([]),
  errors: z.array(errorSummarySchema).default([]),
  metrics: z.array(seriesSchema).default([]),
  /** Deployments that happened shortly before the problem started. Correlation, never a claim of causation. */
  deployments: z.array(z.object({ deployment: deploymentSummarySchema, minutesBeforeProblem: z.number() })).default([]),
  repository: z.array(repositoryEvidenceSchema).default([]),
  possibleCauses: z.array(evidenceSchema).default([]),
  alerts: z.array(alertSummarySchema).default([]),
  incident: refSchema.optional(),
  investigationId: id.optional(),
  allowedActions: actions,
});
export type ProblemDetail = z.infer<typeof problemDetailSchema>;

export const investigationSchema = z.object({
  id,
  title: z.string(),
  subject: refSchema,
  status: lenientEnum(['open', 'concluded'] as const, 'open'),
  startedAt: epoch,
  /** Set once the investigation is concluded, so its duration can be stated. */
  concludedAt: epoch.optional(),
  summary: z.string().optional(),
  timeline: z.array(evidenceSchema),
});
export type Investigation = z.infer<typeof investigationSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Errors and logs

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal', 'unknown'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const logEntrySchema = z.object({
  id,
  timestamp: epoch,
  level: lenientEnum(LOG_LEVELS, 'unknown'),
  service: z.string().optional(),
  source: z.string().optional(),
  message: z.string(),
  fields: z.record(z.string(), z.string()).optional(),
  links: z.object({ errorId: id.optional(), problemId: id.optional(), serviceId: id.optional(), deploymentId: id.optional(), incidentId: id.optional() }).optional(),
});
export type LogEntry = z.infer<typeof logEntrySchema>;

export const stackFrameSchema = z.object({
  function: z.string().optional(),
  file: z.string().optional(),
  line: z.number().int().optional(),
  column: z.number().int().optional(),
  module: z.string().optional(),
  /** Application code rather than a dependency or the runtime. The viewer emphasises these frames. */
  inApp: z.boolean().default(false),
  context: z.array(z.object({ line: z.number().int(), code: z.string() })).optional(),
});
export type StackFrame = z.infer<typeof stackFrameSchema>;

export const errorDetailSchema = errorSummarySchema.extend({
  frames: z.array(stackFrameSchema).default([]),
  rawStack: z.string().optional(),
  instances: z.array(z.string()).default([]),
  sampleLogs: z.array(logEntrySchema).default([]),
  /** The full series on the detail; the summary carries only the direction. */
  trend: seriesSchema.optional(),
  /**
   * Deployments shortly before the group started or regressed, and the code the stack trace points at: the same
   * shapes `problemDetail` carries, because an error with no problem would otherwise have no route to either.
   * Correlation, never a claim of causation.
   */
  deployments: z.array(z.object({ deployment: deploymentSummarySchema, minutesBeforeError: z.number() })).default([]),
  repository: z.array(repositoryEvidenceSchema).default([]),
  allowedActions: actions,
});
export type ErrorDetail = z.infer<typeof errorDetailSchema>;

export const logSearchSchema = z.object({
  searchId: z.string(),
  status: lenientEnum(['running', 'complete', 'partial', 'failed'] as const, 'failed'),
  items: z.array(logEntrySchema),
  nextCursor: z.string().nullable().default(null),
  statistics: z.object({ recordsMatched: z.number(), recordsScanned: z.number() }).optional(),
});
export type LogSearch = z.infer<typeof logSearchSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Services and infrastructure

export const serviceSummarySchema = z.object({
  id,
  name: z.string(),
  kind: z.string().optional(),
  health: healthStatusSchema,
  errorRate: metricValueSchema,
  latencyP95: metricValueSchema,
  requests: metricValueSchema,
  openProblems: nullableNumber.default(null),
  firingAlerts: nullableNumber.default(null),
});
export type ServiceSummary = z.infer<typeof serviceSummarySchema>;

export const INFRA_CATEGORIES = ['ecs', 'ec2', 'rds', 'redis', 'load-balancer', 'storage', 'network', 'other'] as const;
export type InfraCategory = (typeof INFRA_CATEGORIES)[number];

export const infraResourceSchema = z.object({
  id,
  name: z.string(),
  category: lenientEnum(INFRA_CATEGORIES, 'other'),
  health: healthStatusSchema,
  /** The provider's own status word (for example `available`, `ACTIVE`), shown as is. */
  status: z.string().optional(),
  summary: z.string().optional(),
  keyMetrics: z.array(z.object({ label: z.string(), value: metricValueSchema })).default([]),
  anomalies: z.array(z.string()).default([]),
});
export type InfraResource = z.infer<typeof infraResourceSchema>;

export const infraDetailSchema = infraResourceSchema.extend({
  properties: z.array(z.object({ label: z.string(), value: z.string() })).default([]),
  series: z.array(seriesSchema).default([]),
  related: z.array(refSchema).default([]),
  problems: z.array(problemSummarySchema).default([]),
});
export type InfraDetail = z.infer<typeof infraDetailSchema>;

export const serviceDetailSchema = serviceSummarySchema.extend({
  description: z.string().optional(),
  series: z.array(seriesSchema).default([]),
  infrastructure: z.array(infraResourceSchema).default([]),
  dependencies: z.array(z.object({ ref: refSchema, health: healthStatusSchema })).default([]),
  deployments: z.array(deploymentSummarySchema).default([]),
  problems: z.array(problemSummarySchema).default([]),
  alerts: z.array(alertSummarySchema).default([]),
  allowedActions: actions,
});
export type ServiceDetail = z.infer<typeof serviceDetailSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Alerts, incidents

export const alertDetailSchema = alertSummarySchema.extend({
  description: z.string().optional(),
  condition: z.string().optional(),
  metric: seriesSchema.optional(),
  history: z.array(z.object({ at: epoch, status: z.string(), reason: z.string().optional() })).default([]),
  acknowledgedBy: z.string().optional(),
  acknowledgedAt: epoch.optional(),
  allowedActions: actions,
});
export type AlertDetail = z.infer<typeof alertDetailSchema>;

export const INCIDENT_STATUSES = ['open', 'investigating', 'mitigated', 'resolved'] as const;
export const incidentSummarySchema = z.object({
  id,
  title: z.string(),
  severity: severitySchema,
  status: lenientEnum(INCIDENT_STATUSES, 'open'),
  startedAt: epoch,
  resolvedAt: epoch.nullable().default(null),
  affectedServices: z.array(refSchema).default([]),
});
export type IncidentSummary = z.infer<typeof incidentSummarySchema>;

export const incidentDetailSchema = incidentSummarySchema.extend({
  summary: z.string().optional(),
  timeline: z.array(z.object({ at: epoch, type: z.string(), text: z.string(), ref: refSchema.optional() })).default([]),
  problems: z.array(problemSummarySchema).default([]),
  notes: z.array(z.object({ at: epoch, author: z.string().optional(), text: z.string() })).default([]),
  resolution: z.string().optional(),
  allowedActions: actions,
});
export type IncidentDetail = z.infer<typeof incidentDetailSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Synthetics, SLOs, deployments

export const syntheticSummarySchema = z.object({
  id,
  name: z.string(),
  kind: z.string(),
  target: z.string(),
  status: lenientEnum(['up', 'down', 'degraded', 'unknown'] as const, 'unknown'),
  /** Fractions between 0 and 1. */
  availability24h: nullableNumber.default(null),
  uptime30d: nullableNumber.default(null),
  latencyMs: nullableNumber.default(null),
  ssl: z.object({ valid: z.boolean().nullable(), expiresAt: epoch.nullable(), issuer: z.string().optional() }).nullable().default(null),
  lastCheckedAt: epoch.nullable(),
});
export type SyntheticSummary = z.infer<typeof syntheticSummarySchema>;

export const syntheticDetailSchema = syntheticSummarySchema.extend({
  latency: seriesSchema.optional(),
  /** One bucket per period, `up: null` when no check ran. */
  availability: z.array(z.object({ at: epoch, up: z.boolean().nullable() })).default([]),
  failures: z
    .array(z.object({ at: epoch, reason: z.string(), statusCode: z.number().int().optional(), location: z.string().optional() }))
    .default([]),
  problem: refSchema.optional(),
});
export type SyntheticDetail = z.infer<typeof syntheticDetailSchema>;

export const sloSummarySchema = z.object({
  id,
  name: z.string(),
  service: refSchema.optional(),
  /** Fractions: 0.999 is 99.9 %. */
  target: z.number(),
  current: nullableNumber,
  window: z.string(),
  /** Fraction of the error budget left; negative when the budget is exhausted. */
  budgetRemaining: nullableNumber,
  burnRate: nullableNumber.default(null),
  status: lenientEnum(['healthy', 'at_risk', 'breached', 'unknown'] as const, 'unknown'),
});
export type SloSummary = z.infer<typeof sloSummarySchema>;

export const sloDetailSchema = sloSummarySchema.extend({
  description: z.string().optional(),
  performance: seriesSchema.optional(),
  budget: seriesSchema.optional(),
});
export type SloDetail = z.infer<typeof sloDetailSchema>;

export const deploymentDetailSchema = deploymentSummarySchema.extend({
  description: z.string().optional(),
  /** Problems that started after this deployment, with the delay. Correlation only. */
  relatedProblems: z.array(z.object({ problem: problemSummarySchema, minutesAfterDeployment: z.number() })).default([]),
  changes: z.object({ files: z.number(), additions: z.number(), deletions: z.number() }).optional(),
  evidence: z.array(repositoryEvidenceSchema).default([]),
  allowedActions: actions,
});
export type DeploymentDetail = z.infer<typeof deploymentDetailSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Health and brief

export const changeSchema = z.object({
  id,
  /** When the change happened inside the covered period, when the server can say. */
  at: epoch.optional(),
  direction: lenientEnum(['up', 'down', 'new', 'resolved', 'stable'] as const, 'stable'),
  text: z.string(),
  severity: severitySchema.optional(),
  ref: refSchema.optional(),
});
export type Change = z.infer<typeof changeSchema>;

export const familySchema = z.object({
  family: z.string(),
  label: z.string(),
  status: healthStatusSchema,
  total: nullableNumber,
  affected: nullableNumber,
  /**
   * Present when the server could not read this family (missing permission, throttling, error). `reason` and `code`
   * are for logic; `messageKey` + `values` render in the app's own language, and `message` is the server's rendering
   * for a client without the catalogue.
   */
  unavailable: z
    .object({
      reason: z.string(),
      code: z.string().optional(),
      messageKey: z.string().optional(),
      values: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
      message: z.string().optional(),
    })
    .optional(),
});
export type Family = z.infer<typeof familySchema>;

export const healthCountsSchema = z.object({
  critical: z.number(),
  warning: z.number(),
  healthyServices: nullableNumber,
  totalServices: nullableNumber,
});

export const healthSchema = z.object({
  generatedAt: epoch,
  status: healthStatusSchema,
  headline: z.string().optional(),
  counts: healthCountsSchema,
  families: z.array(familySchema).default([]),
  topProblem: problemSummarySchema.nullable().default(null),
  activeAlerts: nullableNumber.default(null),
  synthetics: z.object({ up: z.number(), down: z.number(), degraded: z.number() }).nullable().default(null),
  recentIncidents: z.array(incidentSummarySchema).default([]),
  recentDeployments: z.array(deploymentSummarySchema).default([]),
  changes: z.array(changeSchema).default([]),
});
export type Health = z.infer<typeof healthSchema>;

export const briefSchema = z.object({
  generatedAt: epoch,
  period: z.object({ from: epoch, to: epoch }),
  status: healthStatusSchema,
  counts: healthCountsSchema,
  changes: z.array(changeSchema),
  mostImportant: problemSummarySchema.nullable(),
});
export type Brief = z.infer<typeof briefSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// AI, search, favorites, devices

export const aiAnswerSchema = z.object({
  id,
  answer: z.string(),
  generatedAt: epoch,
  citations: z.array(refSchema).default([]),
  model: z.string().optional(),
});
export type AiAnswer = z.infer<typeof aiAnswerSchema>;

export const searchResultSchema = z.object({
  type: refTypeSchema,
  id,
  title: z.string(),
  subtitle: z.string().optional(),
  severity: severitySchema.optional(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;
export const searchResponseSchema = z.object({ items: z.array(searchResultSchema) });

export const FAVORITE_TYPES = ['service', 'environment', 'synthetic', 'view'] as const;
export type FavoriteType = (typeof FAVORITE_TYPES)[number];
export const favoriteSchema = z.object({ type: z.enum(FAVORITE_TYPES), id, label: z.string() });
export type Favorite = z.infer<typeof favoriteSchema>;
export const favoritesSchema = z.object({ items: z.array(favoriteSchema) });

export const NOTIFICATION_CATEGORIES = ['critical_problem', 'alert', 'synthetic_failure', 'incident', 'recovery'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export const MIN_SEVERITIES = ['critical', 'warning', 'info'] as const;
export type NotificationPreferences = {
  /** `critical`: critical only; `warning`: critical and warning; `info`: everything. */
  minSeverity: (typeof MIN_SEVERITIES)[number];
  categories: NotificationCategory[];
};
export const deviceRegistrationSchema = z.object({ id });
export type DeviceRegistration = z.infer<typeof deviceRegistrationSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Errors

/** `action` and `code` carry the AWS permission and error behind a failure, for example `logs:StartQuery`. */
export const apiErrorBodySchema = z.object({ error: z.string(), message: z.string().optional(), action: z.string().optional(), code: z.string().optional() });
