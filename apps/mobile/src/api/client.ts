/**
 * The OpsWatch client interface. Screens and hooks depend on this interface only; `createHttpClient` talks to a real
 * server and `createDemoClient` (src/demo) answers from fixtures.
 */
import { z } from 'zod';
import {
  API_PREFIX,
  aiAnswerSchema,
  alertDetailSchema,
  alertSummarySchema,
  authSessionSchema,
  briefSchema,
  deploymentDetailSchema,
  deploymentSummarySchema,
  deviceRegistrationSchema,
  environmentSchema,
  errorDetailSchema,
  errorSummarySchema,
  favoritesSchema,
  healthSchema,
  incidentDetailSchema,
  incidentSummarySchema,
  infraDetailSchema,
  infraResourceSchema,
  investigationSchema,
  logSearchSchema,
  pageSchema,
  problemDetailSchema,
  problemSummarySchema,
  repositoryEvidenceSchema,
  searchResponseSchema,
  serverInfoSchema,
  serviceDetailSchema,
  serviceSummarySchema,
  sloDetailSchema,
  sloSummarySchema,
  syntheticDetailSchema,
  syntheticSummarySchema,
  userSchema,
  type AiAnswer,
  type AlertDetail,
  type AlertSummary,
  type AuthSession,
  type Brief,
  type DeploymentDetail,
  type DeploymentSummary,
  type DeviceRegistration,
  type Environment,
  type ErrorDetail,
  type ErrorSummary,
  type Favorite,
  type Health,
  type IncidentDetail,
  type IncidentSummary,
  type InfraCategory,
  type InfraDetail,
  type InfraResource,
  type Investigation,
  type LogLevel,
  type LogSearch,
  type NotificationPreferences,
  type Page,
  type ProblemDetail,
  type ProblemStatus,
  type ProblemSummary,
  type Ref,
  type RepositoryEvidence,
  type SearchResult,
  type ServerInfo,
  type ServiceDetail,
  type ServiceSummary,
  type Severity,
  type SloDetail,
  type SloSummary,
  type SyntheticDetail,
  type SyntheticSummary,
  type User,
  systemStatusSchema,
  type SystemStatus,
} from './contract';
import { request, type Transport } from './http';

export type ProblemFilters = {
  status?: ProblemStatus | 'open';
  severity?: Severity[];
  service?: string;
  category?: string;
  /** Epoch ms lower bound on `lastSeenAt`. */
  since?: number;
};
export type ErrorFilters = { status?: ErrorSummary['status']; service?: string };
export type AlertFilters = { status?: AlertSummary['status'] | 'history' };
export type LogQuery = {
  text?: string;
  service?: string;
  levels?: LogLevel[];
  source?: string;
  from: number;
  to: number;
};

/** Scope of every data call. `env` is the environment id chosen in the app, or undefined for the server default. */
export type Scope = { env?: string };

export interface OpsWatchClient {
  readonly mode: 'http' | 'demo';
  getServerInfo(): Promise<ServerInfo>;
  login(email: string, password: string): Promise<AuthSession>;
  exchangeGoogleCode(code: string, codeVerifier: string, redirectUri: string): Promise<AuthSession>;
  googleStartUrl(redirectUri: string, codeChallenge: string, state: string): string;
  logout(): Promise<void>;
  me(): Promise<User>;

  environments(): Promise<Environment[]>;
  /**
   * What OpsWatch knows about itself. Not environment-scoped: it reports on the instance. Administrator-only, so a
   * `forbidden` here is an ordinary answer for a non-admin account, not a failure.
   */
  systemStatus(): Promise<SystemStatus>;
  health(scope: Scope): Promise<Health>;
  brief(scope: Scope): Promise<Brief>;

  problems(scope: Scope, filters: ProblemFilters, cursor?: string | null): Promise<Page<ProblemSummary>>;
  problem(scope: Scope, id: string): Promise<ProblemDetail>;
  acknowledgeProblem(scope: Scope, id: string): Promise<void>;

  errors(scope: Scope, filters: ErrorFilters, cursor?: string | null): Promise<Page<ErrorSummary>>;
  error(scope: Scope, id: string): Promise<ErrorDetail>;

  services(scope: Scope): Promise<ServiceSummary[]>;
  service(scope: Scope, id: string): Promise<ServiceDetail>;

  infrastructure(scope: Scope, category?: InfraCategory): Promise<InfraResource[]>;
  infrastructureResource(scope: Scope, id: string): Promise<InfraDetail>;

  searchLogs(scope: Scope, query: LogQuery, cursor?: string | null): Promise<LogSearch>;
  pollLogs(scope: Scope, searchId: string, cursor?: string | null): Promise<LogSearch>;
  /** Releases the server-side query (CloudWatch Logs Insights has a concurrency limit). Best effort. */
  cancelLogs(scope: Scope, searchId: string): Promise<void>;

  alerts(scope: Scope, filters: AlertFilters, cursor?: string | null): Promise<Page<AlertSummary>>;
  alert(scope: Scope, id: string): Promise<AlertDetail>;
  acknowledgeAlert(scope: Scope, id: string): Promise<void>;

  incidents(scope: Scope, cursor?: string | null): Promise<Page<IncidentSummary>>;
  incident(scope: Scope, id: string): Promise<IncidentDetail>;

  synthetics(scope: Scope): Promise<SyntheticSummary[]>;
  synthetic(scope: Scope, id: string): Promise<SyntheticDetail>;

  slos(scope: Scope): Promise<SloSummary[]>;
  slo(scope: Scope, id: string): Promise<SloDetail>;

  deployments(scope: Scope, cursor?: string | null): Promise<Page<DeploymentSummary>>;
  deployment(scope: Scope, id: string): Promise<DeploymentDetail>;

  investigation(scope: Scope, id: string): Promise<Investigation>;
  repositoryEvidence(scope: Scope, id: string): Promise<RepositoryEvidence>;

  /** `signal` lets a screen abandon a long answer; the request is cancelled rather than left running. */
  ask(scope: Scope, question: string, context?: Ref, signal?: AbortSignal): Promise<AiAnswer>;
  search(scope: Scope, text: string): Promise<SearchResult[]>;

  favorites(): Promise<Favorite[]>;
  saveFavorites(items: Favorite[]): Promise<Favorite[]>;

  registerDevice(input: { pushToken: string; platform: 'ios' | 'android'; preferences: NotificationPreferences }): Promise<DeviceRegistration>;
  unregisterDevice(id: string): Promise<void>;
}

const empty = z.unknown().transform(() => undefined);
const listOf = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) }).transform((body) => body.items);

export const AI_TIMEOUT_MS = 60_000;
const LOGS_TIMEOUT_MS = 30_000;

export type HttpClientOptions = Transport & {
  /** Reads the current token at call time so a refreshed or cleared session applies immediately. */
  getToken: () => string | null;
};

export function createHttpClient(options: HttpClientOptions): OpsWatchClient {
  const { getToken, ...transport } = options;
  const p = (path: string) => `${API_PREFIX}${path}`;
  const enc = encodeURIComponent;

  function get<T extends z.ZodType>(path: string, schema: T, query?: Record<string, string | number | undefined | null | readonly string[]>, timeoutMs?: number) {
    return request(transport, { path: p(path), schema, query, token: getToken(), timeoutMs });
  }
  function send<T extends z.ZodType>(method: 'POST' | 'PUT' | 'DELETE', path: string, schema: T, body?: unknown, extra: { timeoutMs?: number; token?: boolean } = {}) {
    return request(transport, {
      method,
      path: p(path),
      schema,
      body,
      token: extra.token === false ? null : getToken(),
      timeoutMs: extra.timeoutMs,
    });
  }
  const env = (scope: Scope) => ({ env: scope.env });

  return {
    mode: 'http',
    getServerInfo: () => request(transport, { path: p('/server'), schema: serverInfoSchema, retries: 0, timeoutMs: 10_000 }),
    login: (email, password) => send('POST', '/auth/login', authSessionSchema, { email, password }, { token: false }),
    exchangeGoogleCode: (code, codeVerifier, redirectUri) =>
      send('POST', '/auth/google/exchange', authSessionSchema, { code, codeVerifier, redirectUri }, { token: false }),
    googleStartUrl: (redirectUri, codeChallenge, state) => {
      const url = new URL(`${transport.baseUrl.replace(/\/+$/, '')}${p('/auth/google/start')}`);
      url.searchParams.set('redirectUri', redirectUri);
      url.searchParams.set('codeChallenge', codeChallenge);
      url.searchParams.set('codeChallengeMethod', 'S256');
      url.searchParams.set('state', state);
      return url.toString();
    },
    logout: () => send('POST', '/auth/logout', empty),
    me: () => get('/me', userSchema),

    environments: () => get('/environments', listOf(environmentSchema)),
    systemStatus: () => get('/system/status', systemStatusSchema),
    health: (scope) => get('/health', healthSchema, env(scope)),
    brief: (scope) => get('/brief', briefSchema, env(scope)),

    problems: (scope, f, cursor) =>
      get('/problems', pageSchema(problemSummarySchema), {
        ...env(scope),
        status: f.status,
        severity: f.severity,
        service: f.service,
        category: f.category,
        since: f.since,
        cursor,
      }),
    problem: (scope, id) => get(`/problems/${enc(id)}`, problemDetailSchema, env(scope)),
    acknowledgeProblem: async (scope, id) => {
      await request(transport, { method: 'POST', path: p(`/problems/${enc(id)}/acknowledge`), schema: empty, token: getToken(), query: env(scope) });
    },

    errors: (scope, f, cursor) => get('/errors', pageSchema(errorSummarySchema), { ...env(scope), status: f.status, service: f.service, cursor }),
    error: (scope, id) => get(`/errors/${enc(id)}`, errorDetailSchema, env(scope)),

    services: (scope) => get('/services', listOf(serviceSummarySchema), env(scope)),
    service: (scope, id) => get(`/services/${enc(id)}`, serviceDetailSchema, env(scope)),

    infrastructure: (scope, category) => get('/infrastructure', listOf(infraResourceSchema), { ...env(scope), category }),
    infrastructureResource: (scope, id) => get(`/infrastructure/${enc(id)}`, infraDetailSchema, env(scope)),

    searchLogs: (scope, q, cursor) =>
      request(transport, {
        method: 'POST',
        path: p('/logs/search'),
        schema: logSearchSchema,
        token: getToken(),
        query: env(scope),
        body: { text: q.text, service: q.service, levels: q.levels, source: q.source, from: q.from, to: q.to, cursor },
        timeoutMs: LOGS_TIMEOUT_MS,
        // Starting a search has no side effect beyond server work, so a network blip may retry it.
        idempotent: true,
      }),
    pollLogs: (scope, searchId, cursor) => get(`/logs/search/${enc(searchId)}`, logSearchSchema, { ...env(scope), cursor }, LOGS_TIMEOUT_MS),

    cancelLogs: async (scope, searchId) => {
      await request(transport, { method: 'DELETE', path: p(`/logs/search/${enc(searchId)}`), schema: empty, token: getToken(), query: env(scope), retries: 0, timeoutMs: 5_000 });
    },

    alerts: (scope, f, cursor) => get('/alerts', pageSchema(alertSummarySchema), { ...env(scope), status: f.status, cursor }),
    alert: (scope, id) => get(`/alerts/${enc(id)}`, alertDetailSchema, env(scope)),
    acknowledgeAlert: async (scope, id) => {
      await request(transport, { method: 'POST', path: p(`/alerts/${enc(id)}/acknowledge`), schema: empty, token: getToken(), query: env(scope) });
    },

    incidents: (scope, cursor) => get('/incidents', pageSchema(incidentSummarySchema), { ...env(scope), cursor }),
    incident: (scope, id) => get(`/incidents/${enc(id)}`, incidentDetailSchema, env(scope)),

    synthetics: (scope) => get('/synthetics', listOf(syntheticSummarySchema), env(scope)),
    synthetic: (scope, id) => get(`/synthetics/${enc(id)}`, syntheticDetailSchema, env(scope)),

    slos: (scope) => get('/slos', listOf(sloSummarySchema), env(scope)),
    slo: (scope, id) => get(`/slos/${enc(id)}`, sloDetailSchema, env(scope)),

    deployments: (scope, cursor) => get('/deployments', pageSchema(deploymentSummarySchema), { ...env(scope), cursor }),
    deployment: (scope, id) => get(`/deployments/${enc(id)}`, deploymentDetailSchema, env(scope)),

    investigation: (scope, id) => get(`/investigations/${enc(id)}`, investigationSchema, env(scope)),
    repositoryEvidence: (scope, id) => get(`/repository/evidence/${enc(id)}`, repositoryEvidenceSchema, env(scope)),

    ask: (scope, question, context, signal) =>
      request(transport, {
        method: 'POST',
        path: p('/ai/ask'),
        schema: aiAnswerSchema,
        token: getToken(),
        query: env(scope),
        // References only: the server gathers the evidence itself.
        body: { question, context: context ? { type: context.type, id: context.id } : undefined },
        timeoutMs: AI_TIMEOUT_MS,
        signal,
      }),
    search: (scope, text) => get('/search', searchResponseSchema, { ...env(scope), q: text }).then((r) => r.items),

    favorites: () => get('/me/favorites', favoritesSchema).then((r) => r.items),
    saveFavorites: (items) => send('PUT', '/me/favorites', favoritesSchema, { items }).then((r) => r.items),

    registerDevice: (input) => send('POST', '/me/devices', deviceRegistrationSchema, input),
    unregisterDevice: async (id) => {
      await send('DELETE', `/me/devices/${enc(id)}`, empty);
    },
  };
}
