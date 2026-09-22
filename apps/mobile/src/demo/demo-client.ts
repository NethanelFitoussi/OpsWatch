/**
 * An OpsWatchClient answering from the demo dataset, with a small simulated latency so loading states are visible.
 * No network access at all. Acknowledgements and favorites live in memory for the session.
 */
import type { OpsWatchClient } from '@/api/client';
import type { Favorite } from '@/api/contract';
import { ApiError } from '@/api/errors';
import * as engine from './engine';
import { buildDemoDataset, DEMO_CREDENTIALS, type DemoDataset } from './fixtures';

export type DemoClientOptions = { latencyMs?: number; now?: () => number };

export function createDemoClient(options: DemoClientOptions = {}): OpsWatchClient {
  const now = options.now ?? Date.now;
  const latency = options.latencyMs ?? 250;
  let data: DemoDataset = buildDemoDataset(now());
  let builtAt = now();
  let favorites: Favorite[] = [{ type: 'service', id: 'svc-checkout-api', label: 'checkout-api' }];

  /** Rebuild every minute so relative times ("3 min ago") keep moving while the demo is open. */
  function fresh(): DemoDataset {
    if (now() - builtAt > 60_000) {
      const acknowledged = new Set(data.alerts.filter((a) => a.status === 'acknowledged').map((a) => a.id));
      const acknowledgedProblems = new Set(data.problems.filter((p) => p.status === 'acknowledged').map((p) => p.id));
      data = buildDemoDataset(now());
      data.alerts.forEach((a) => acknowledged.has(a.id) && (a.status = 'acknowledged'));
      data.problems.forEach((p) => acknowledgedProblems.has(p.id) && (p.status = 'acknowledged'));
      builtAt = now();
    }
    return data;
  }

  /**
   * Answers after a small pause, so loading states are visible. A caller that gives up (an abandoned AI answer)
   * gets the same `cancelled` failure the HTTP client would produce.
   */
  const delay = <T>(value: () => T, factor = 1, signal?: AbortSignal): Promise<T> =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new ApiError('cancelled'));
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        try {
          resolve(value());
        } catch (error) {
          reject(error);
        }
      }, latency * factor);
      function onAbort() {
        clearTimeout(timer);
        reject(new ApiError('cancelled'));
      }
      signal?.addEventListener('abort', onAbort, { once: true });
    });

  const found = <T>(item: T | undefined): T => {
    if (item === undefined) throw new ApiError('not_found', { status: 404, code: 'not_found' });
    return item;
  };

  return {
    mode: 'demo',
    getServerInfo: () => delay(() => fresh().server),
    login: (email, password) =>
      delay(() => {
        if (email.trim().toLowerCase() !== DEMO_CREDENTIALS.email || password !== DEMO_CREDENTIALS.password) {
          throw new ApiError('unauthorized', { status: 401, code: 'invalid_credentials' });
        }
        return { token: 'demo-session-token-not-a-secret', expiresAt: now() + 12 * 3_600_000, user: { email: DEMO_CREDENTIALS.email, name: 'Demo user' } };
      }),
    exchangeGoogleCode: () => Promise.reject(new ApiError('unsupported', { status: 501 })),
    googleStartUrl: () => {
      throw new ApiError('unsupported');
    },
    logout: () => delay(() => undefined, 0.2),
    me: () => delay(() => ({ email: DEMO_CREDENTIALS.email, name: 'Demo user' })),

    environments: () => delay(() => fresh().environments),
    health: (scope) => delay(() => engine.healthFor(fresh(), scope.env, now())),
    brief: (scope) => delay(() => engine.briefFor(fresh(), scope.env, now())),

    problems: (scope, filters, cursor) => delay(() => engine.listProblems(fresh(), scope.env, filters, cursor)),
    problem: (_scope, id) => delay(() => found(engine.findById(fresh().problems, id))),
    acknowledgeProblem: (_scope, id) =>
      delay(() => {
        const problem = found(engine.findById(fresh().problems, id));
        if (!problem.allowedActions.includes('acknowledge')) throw new ApiError('forbidden', { status: 403 });
        problem.status = 'acknowledged';
        problem.allowedActions = problem.allowedActions.filter((a) => a !== 'acknowledge');
      }),

    errors: (scope, filters, cursor) => delay(() => engine.listErrors(fresh(), scope.env, filters, cursor)),
    error: (_scope, id) => delay(() => found(engine.findById(fresh().errors, id))),

    services: (scope) => delay(() => engine.listServices(fresh(), scope.env)),
    service: (_scope, id) => delay(() => found(engine.findById(fresh().services, id))),

    infrastructure: (_scope, category) => delay(() => fresh().infrastructure.filter((r) => !category || r.category === category)),
    infrastructureResource: (_scope, id) => delay(() => found(engine.findById(fresh().infrastructure, id))),

    searchLogs: (scope, query, cursor) => delay(() => engine.searchLogs(fresh(), scope.env, query, cursor), 2),
    pollLogs: () => Promise.reject(new ApiError('not_found', { status: 404 })),
    cancelLogs: () => Promise.resolve(),

    alerts: (scope, filters, cursor) => delay(() => engine.listAlerts(fresh(), scope.env, filters, cursor)),
    alert: (_scope, id) => delay(() => found(engine.findById(fresh().alerts, id))),
    acknowledgeAlert: (_scope, id) =>
      delay(() => {
        const alert = found(engine.findById(fresh().alerts, id));
        if (!alert.allowedActions.includes('acknowledge')) throw new ApiError('forbidden', { status: 403 });
        alert.status = 'acknowledged';
        alert.acknowledgedBy = DEMO_CREDENTIALS.email;
        alert.acknowledgedAt = now();
        alert.allowedActions = alert.allowedActions.filter((a) => a !== 'acknowledge');
      }),

    incidents: (scope, cursor) => delay(() => engine.listIncidents(fresh(), scope.env, cursor)),
    incident: (_scope, id) => delay(() => found(engine.findById(fresh().incidents, id))),

    synthetics: () => delay(() => fresh().synthetics),
    synthetic: (_scope, id) => delay(() => found(engine.findById(fresh().synthetics, id))),

    slos: () => delay(() => fresh().slos),
    slo: (_scope, id) => delay(() => found(engine.findById(fresh().slos, id))),

    deployments: (scope, cursor) => delay(() => engine.listDeployments(fresh(), scope.env, cursor)),
    deployment: (_scope, id) => delay(() => found(engine.findById(fresh().deployments, id))),

    investigation: (_scope, id) => delay(() => found(engine.findById(fresh().investigations, id))),
    repositoryEvidence: (_scope, id) => delay(() => found(engine.findById(fresh().repository, id))),

    ask: (_scope, question, context, signal) => delay(() => engine.ask(fresh(), question, context, now()), 4, signal),
    search: (scope, text) => delay(() => engine.search(fresh(), scope.env, text), 0.5),

    favorites: () => delay(() => favorites, 0.3),
    saveFavorites: (items) =>
      delay(() => {
        favorites = items;
        return favorites;
      }, 0.3),

    registerDevice: () => Promise.reject(new ApiError('unsupported', { status: 501 })),
    unregisterDevice: () => Promise.resolve(),
  };
}
