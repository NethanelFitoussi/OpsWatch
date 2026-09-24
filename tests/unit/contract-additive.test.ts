import { describe, expect, it } from 'vitest';
import * as contract from '@opswatch/contract';
import type * as types from '@opswatch/contract';

/**
 * §33.1: inside v1 the contract only ever **adds**. A field may be added as optional; nothing is renamed and
 * nothing is removed, because a client written against the older shape has to keep working — and the web app,
 * the mobile app and the OpenAPI document all read this one package.
 *
 * The two lists below are that promise, written down. They may **grow** freely. A name leaving one is a
 * breaking change, and the point of writing them out is that removing a name means editing this file, which
 * is the moment you notice you are doing it.
 *
 * Regenerate after an addition:
 *   grep -hoP '^export (?:const|function|class|enum) \K\w+' packages/contract/*.ts | sort -u
 *   grep -hoP '^export type \K\w+'                          packages/contract/*.ts | sort -u
 */
const PROMISED_VALUES = [
  'ACCOUNT_SCOPE', 'ALERT_STATUSES', 'API_ERROR_CODES', 'API_ERROR_STATUS', 'API_PREFIX', 'API_VERSION',
  'CHANGE_DIRECTIONS', 'CHECK_NOT_RUN_REASONS', 'DEFAULT_PAGE_SIZE', 'DEPLOYMENT_STATUSES', 'ENDPOINT_PAGINATION', 'ENVIRONMENT_KINDS',
  'ERROR_STATUSES', 'EVIDENCE_KINDS', 'FAVORITE_TYPES', 'FEATURES', 'HEALTH_STATUSES', 'INCIDENT_STATUSES',
  'INFRA_CATEGORIES', 'INGEST_LIMITS', 'INGEST_SOURCES', 'LOG_LEVELS', 'MAX_PAGE_SIZE', 'METRIC_UNITS', 'MIN_PAGE_SIZE', 'MIN_SEVERITIES',
  'NOTIFICATION_CATEGORIES', 'PERMISSIONS', 'PERMISSION_NAMES', 'PROBLEM_STATUSES', 'REF_TYPES', 'ROLES',
  'GLOBAL_SEARCH_KINDS', 'SEVERITIES', 'SLO_STATUSES', 'SYNTHETIC_STATUSES', 'TOKEN_AUDIENCES', 'TRENDS', 'aiAnswerSchema', 'globalSearchResponseSchema', 'globalSearchResultSchema',
  'alertDetailSchema', 'alertSummarySchema', 'allowedActionsSchema', 'apiErrorBodySchema', 'authSessionSchema',
  'briefSchema', 'can', 'changeSchema', 'checkFindingSchema', 'checkNotRunReasonSchema',
  'checkNotRunSchema', 'checkupSchema', 'checkValuesSchema', 'CLOUDFLARE_STATES', 'cloudflareDaySchema', 'cloudflareOverviewSchema', 'cloudflareZoneSchema', 'commitSchema', 'decodeCursor', 'deploymentDetailSchema',
  'deploymentSummarySchema', 'deviceRegistrationSchema', 'encodeCursor', 'environmentId',
  'environmentListSchema', 'environmentSchema', 'environmentStatusSchema', 'epochSchema', 'errorDetailSchema',
  'errorSummarySchema', 'evidenceSchema', 'familySchema', 'favoriteSchema', 'filtersFor', 'favoritesSchema',
  'healthCountsSchema', 'healthSchema', 'healthStatusSchema', 'idSchema', 'incidentDetailSchema',
  'incidentSummarySchema', 'infraDetailSchema', 'infraResourceSchema', 'ingestAcceptedSchema', 'ingestLogRecordSchema',
  'ingestLogsRequestSchema', 'investigationSchema', 'jobStatusSchema',
  'lenientEnum', 'LIST_FILTERS', 'logEntrySchema', 'logSearchSchema', 'loginRequestSchema', 'meSchema', 'metricUnitSchema',
  'metricValueSchema', 'notificationPreferencesSchema', 'nullableNumberSchema', 'pageSchema',
  'parseEnvironmentId', 'permissionSchema', 'permissionsOf', 'problemDetailSchema', 'problemSummarySchema',
  'refSchema', 'refTypeSchema', 'RESERVED_LIST_PARAMS', 'REPORT_PERIODS', 'REPORT_UNAVAILABLE_REASONS', 'reportFigureSchema',
  'reportRowSchema', 'reportSchema', 'reportSectionSchema', 'reportUnavailableReasonSchema',
  'REPOSITORY_CONNECTION_STATES', 'repositoryEvidenceSchema', 'repositoryStateSchema', 'repositorySummarySchema', 'roleSchema', 'searchResponseSchema',
  'searchResultSchema', 'seriesSchema', 'serverInfoSchema', 'serviceDetailSchema', 'serviceSummarySchema',
  'sessionListSchema', 'sessionSummarySchema', 'severitySchema', 'sloDetailSchema', 'sloSummarySchema',
  'stackFrameSchema', 'syntheticDetailSchema', 'syntheticSummarySchema', 'systemStatusSchema',
  'tokenAudienceSchema', 'trendSchema', 'userPreferencesSchema', 'userSchema',
];

/**
 * Types are erased at runtime, so they cannot be checked by looking in the module. Naming each one through
 * the namespace is what enforces them: if one is removed, **this file stops compiling** and `npm run
 * typecheck` fails, which is the same gate by a different route.
 */
type PromisedTypes = [
  types.AiAnswer, types.AlertDetail, types.AlertStatus, types.AlertSummary, types.ApiErrorBody,
  types.ApiErrorCode, types.AuthSession, types.Brief, types.Change, types.ChangeDirection, types.CheckFinding, types.CheckNotRun,
  types.CheckNotRunReason, types.Checkup, types.Commit,
  types.CursorPosition, types.DeploymentDetail, types.DeploymentStatus, types.DeploymentSummary,
  types.DeviceRegistration, types.Environment, types.EnvironmentKind, types.EnvironmentList,
  types.EnvironmentStatus, types.ErrorDetail, types.ErrorStatus, types.ErrorSummary, types.Evidence,
  types.EvidenceKind, types.Family, types.Favorite, types.FilteredEndpoint, types.ListFilterKind, types.FavoriteType, types.Favorites, types.Feature,
  types.Health, types.HealthCounts, types.HealthStatus, types.IncidentDetail, types.IncidentStatus,
  types.IncidentSummary, types.InfraCategory, types.InfraDetail, types.InfraResource, types.Investigation,
  types.JobStatus, types.LogEntry, types.LogLevel, types.LogSearch, types.LoginRequest, types.Me,
  types.MetricUnit, types.MetricValue, types.NotificationCategory, types.NotificationPreferences,
  types.Page<unknown>, types.PaginatedEndpoint, types.Permission, types.ProblemDetail, types.ProblemStatus,
  types.ProblemSummary, types.Ref, types.RefType, types.Report, types.ReportFigure, types.ReportPeriod,
  types.ReportRow, types.ReportSection, types.ReportUnavailableReason, types.RepositoryEvidence, types.Role,
  types.SearchResponse,
  types.SearchResult, types.Series, types.ServerInfo, types.ServiceDetail, types.ServiceSummary,
  types.SessionList, types.SessionSummary, types.Severity, types.SloDetail, types.SloStatus, types.SloSummary,
  types.StackFrame, types.SyntheticDetail, types.SyntheticStatus, types.SyntheticSummary, types.SystemStatus,
  types.TokenAudience, types.Trend, types.User, types.UserPreferences,
];

describe('the contract only ever adds', () => {
  it('still exports every value it has ever promised', () => {
    expect(PROMISED_VALUES.filter((name) => !(name in contract))).toEqual([]);
  });

  it('has not shrunk', () => {
    expect(PROMISED_VALUES.length).toBeGreaterThanOrEqual(123);
  });

  it('exports every promised schema as something usable, not merely present', () => {
    // A schema that stopped being a schema would still be "in" the module while breaking every client, which
    // validates each response at runtime.
    const values = contract as unknown as Record<string, { safeParse?: unknown } | undefined>;
    // `pageSchema` is a factory — `pageSchema(item)` builds the schema for a page of that item — so it is a
    // function rather than a schema, and is checked as one.
    const FACTORIES = new Set(['pageSchema']);
    const schemas = PROMISED_VALUES.filter((name) => name.endsWith('Schema') && !FACTORIES.has(name));
    for (const factory of FACTORIES) {
      expect(typeof values[factory], factory).toBe('function');
    }
    expect(schemas.length).toBeGreaterThan(40);
    for (const name of schemas) {
      expect(typeof values[name]?.safeParse, name).toBe('function');
    }
  });

  it('keeps the promised types compiling', () => {
    // The assignment is the assertion: `PromisedTypes` cannot resolve if a type was removed or renamed.
    const promised: PromisedTypes | null = null;
    expect(promised).toBeNull();
  });
});
