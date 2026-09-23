/**
 * Filtering, pagination, search and canned AI answers over the demo dataset. Shared by the in-app demo client and the
 * mock server so both behave exactly alike. Pure functions, no React Native import.
 */
import type {
  AiAnswer,
  AlertSummary,
  DeploymentSummary,
  ErrorSummary,
  IncidentSummary,
  LogEntry,
  LogSearch,
  Page,
  ProblemSummary,
  Ref,
  SearchResult,
  ServiceSummary,
  Severity,
  Checkup,
} from '@/api/contract';
import type { AlertFilters, ErrorFilters, LogQuery, ProblemFilters } from '@/api/client';
import { calmHealth, errorSummaryOf, type DemoDataset } from './fixtures';

export const DEMO_PAGE_SIZE = 20;
export const DEMO_LOG_PAGE_SIZE = 50;

export function paginate<T>(items: readonly T[], cursor: string | null | undefined, size: number): Page<T> {
  const start = cursor ? Math.max(0, Number.parseInt(cursor, 10) || 0) : 0;
  const slice = items.slice(start, start + size);
  const next = start + size < items.length ? String(start + size) : null;
  return { items: slice, nextCursor: next };
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export function isProductionEnv(data: DemoDataset, env: string | undefined): boolean {
  return env === undefined || data.environments.find((e) => e.id === env)?.kind === 'production';
}

export function problemSummary(p: ProblemSummary): ProblemSummary {
  const { id, title, severity, status, category, service, resource, firstSeenAt, lastSeenAt, occurrences, trend, summary } = p;
  return { id, title, severity, status, category, service, resource, firstSeenAt, lastSeenAt, occurrences, trend, summary };
}

export function listProblems(data: DemoDataset, env: string | undefined, f: ProblemFilters, cursor?: string | null): Page<ProblemSummary> {
  if (!isProductionEnv(data, env)) return { items: [], nextCursor: null };
  const items = data.problems
    .filter((p) => {
      if (f.status === 'open' && p.status === 'resolved') return false;
      if (f.status && f.status !== 'open' && p.status !== f.status) return false;
      if (f.severity?.length && !f.severity.includes(p.severity)) return false;
      if (f.service && p.service?.id !== f.service) return false;
      if (f.since && p.lastSeenAt < f.since) return false;
      return true;
    })
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.lastSeenAt - a.lastSeenAt)
    .map(problemSummary);
  return paginate(items, cursor, DEMO_PAGE_SIZE);
}

export function listErrors(data: DemoDataset, env: string | undefined, f: ErrorFilters, cursor?: string | null): Page<ErrorSummary> {
  if (!isProductionEnv(data, env)) return { items: [], nextCursor: null };
  const items = data.errors
    .filter((e) => (!f.status || e.status === f.status) && (!f.service || e.service?.id === f.service) && (!f.since || e.lastSeenAt >= f.since))
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .map(errorSummaryOf);
  return paginate(items, cursor, DEMO_PAGE_SIZE);
}

/** Environment-scoped, like every other read. A non-production demo environment has nothing set up to inspect. */
export function checkupFor(data: DemoDataset, env: string | undefined): Checkup {
  if (!isProductionEnv(data, env)) return { generatedAt: data.checkup.generatedAt, findings: [], coverage: { ran: 0, notRun: 0, total: 0 }, notRun: [] };
  return data.checkup;
}

export function listServices(data: DemoDataset, env: string | undefined): ServiceSummary[] {
  const rank = { critical: 0, degraded: 1, unknown: 2, healthy: 3 } as const;
  const list = isProductionEnv(data, env)
    ? data.services
    : data.services.slice(3, 12).map((s) => ({ ...s, health: 'healthy' as const, openProblems: 0, firingAlerts: 0 }));
  return [...list]
    .sort((a, b) => rank[a.health] - rank[b.health] || a.name.localeCompare(b.name))
    .map(({ id, name, kind, health, errorRate, latencyP95, requests, openProblems, firingAlerts }) => ({
      id, name, kind, health, errorRate, latencyP95, requests, openProblems, firingAlerts,
    }));
}

export function listAlerts(data: DemoDataset, env: string | undefined, f: AlertFilters, cursor?: string | null): Page<AlertSummary> {
  if (!isProductionEnv(data, env)) return { items: [], nextCursor: null };
  const items = data.alerts
    .filter((a) => {
      if (!f.status || f.status === 'history') return true;
      return a.status === f.status;
    })
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (b.since ?? 0) - (a.since ?? 0))
    .map(({ id, name, severity, status, source, reason, since, resolvedAt, service, problemId, incidentId }) => ({
      id, name, severity, status, source, reason, since, resolvedAt, service, problemId, incidentId,
    }));
  return paginate(items, cursor, DEMO_PAGE_SIZE);
}

export function listIncidents(data: DemoDataset, env: string | undefined, cursor?: string | null): Page<IncidentSummary> {
  if (!isProductionEnv(data, env)) return { items: [], nextCursor: null };
  const items = data.incidents.map(({ id, title, severity, status, startedAt, resolvedAt, affectedServices }) => ({
    id, title, severity, status, startedAt, resolvedAt, affectedServices,
  }));
  return paginate(items, cursor, DEMO_PAGE_SIZE);
}

export function listDeployments(data: DemoDataset, env: string | undefined, cursor?: string | null): Page<DeploymentSummary> {
  if (!isProductionEnv(data, env)) return { items: [], nextCursor: null };
  const items = [...data.deployments]
    .sort((a, b) => b.at - a.at)
    .map(({ id, service, environment, version, at, status, commit, repository }) => ({ id, service, environment, version, at, status, commit, repository }));
  return paginate(items, cursor, DEMO_PAGE_SIZE);
}

export function healthFor(data: DemoDataset, env: string | undefined, now: number) {
  return isProductionEnv(data, env) ? data.health : calmHealth(now);
}

export function briefFor(data: DemoDataset, env: string | undefined, now: number) {
  if (isProductionEnv(data, env)) return data.brief;
  const calm = calmHealth(now);
  return { generatedAt: calm.generatedAt, period: { from: now - 86_400_000, to: now }, status: calm.status, counts: calm.counts, changes: calm.changes, mostImportant: null };
}

export function searchLogs(data: DemoDataset, env: string | undefined, q: LogQuery, cursor?: string | null): LogSearch {
  const text = q.text?.trim().toLowerCase();
  const matched: LogEntry[] = (isProductionEnv(data, env) ? data.logs : []).filter(
    (l) =>
      l.timestamp >= q.from &&
      l.timestamp <= q.to &&
      (!text || l.message.toLowerCase().includes(text) || l.service?.toLowerCase().includes(text)) &&
      (!q.service || l.service === q.service) &&
      (!q.levels?.length || q.levels.includes(l.level)) &&
      (!q.source || l.source === q.source),
  );
  const page = paginate(matched, cursor, DEMO_LOG_PAGE_SIZE);
  return {
    searchId: `demo-${q.from}-${q.to}`,
    status: 'complete',
    items: page.items,
    nextCursor: page.nextCursor,
    statistics: { recordsMatched: matched.length, recordsScanned: data.logs.length },
  };
}

export function search(data: DemoDataset, env: string | undefined, text: string): SearchResult[] {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  const hit = (...fields: (string | undefined)[]) => fields.some((f) => f?.toLowerCase().includes(q));
  const prod = isProductionEnv(data, env);
  const results: SearchResult[] = [
    ...(prod ? data.problems : []).filter((p) => hit(p.title, p.service?.label, p.resource)).map((p) => ({ type: 'problem' as const, id: p.id, title: p.title, subtitle: p.service?.label, severity: p.severity })),
    ...(prod ? data.errors : []).filter((e) => hit(e.message, e.route, e.service?.label)).map((e) => ({ type: 'error' as const, id: e.id, title: e.message, subtitle: e.service?.label })),
    ...listServices(data, env).filter((s) => hit(s.name)).map((s) => ({ type: 'service' as const, id: s.id, title: s.name, subtitle: s.kind })),
    ...(prod ? data.infrastructure : []).filter((r) => hit(r.name, r.summary, r.category)).map((r) => ({ type: 'infrastructure' as const, id: r.id, title: r.name, subtitle: r.summary })),
    ...(prod ? data.alerts : []).filter((a) => hit(a.name, a.reason)).map((a) => ({ type: 'alert' as const, id: a.id, title: a.name, subtitle: a.status, severity: a.severity })),
    ...(prod ? data.incidents : []).filter((i) => hit(i.title)).map((i) => ({ type: 'incident' as const, id: i.id, title: i.title, subtitle: i.status, severity: i.severity })),
  ];
  return results.slice(0, 40);
}

/** Canned, clearly labelled answers. The real server calls the configured AI provider with evidence it gathers. */
export function ask(data: DemoDataset, question: string, context: Ref | undefined, now: number): AiAnswer {
  const q = question.toLowerCase();
  const cite = (...refs: Ref[]) => refs;
  let answer: string;
  let citations: Ref[];
  if (context?.type === 'error' || q.includes('error') || q.includes('exception')) {
    answer =
      "The TypeError is thrown in `priceCart` when `rates[line.currency]` is undefined, so `rate.value` fails. It started 41 minutes ago, 11 minutes after checkout-api v2.14.0, whose diff rewrote this function. Carts with a currency missing from the rates table would hit it. Check which currencies fail in the sample logs before concluding.";
    citations = cite({ type: 'error', id: 'err-checkout-currency' }, { type: 'deployment', id: 'dep-checkout-2140' }, { type: 'evidence', id: 'ev-repo-checkout-pricing' });
  } else if (q.includes('redis')) {
    answer =
      'sessions-redis latency rose from 0.6 ms to 3.4 ms three hours ago. Memory reached 92 % and evictions started about 10 minutes before the increase. auth-api is the only service using it and its own latency is unchanged, so the impact is limited so far.';
    citations = cite({ type: 'problem', id: 'prb-redis-latency' }, { type: 'infrastructure', id: 'res-sessions-redis' });
  } else if (q.includes('deploy') || q.includes('changed') || context?.type === 'deployment') {
    answer =
      'The last production deployment is checkout-api v2.14.0, 52 minutes ago (7 files, +184/−61). Database connections started rising 3 minutes later and checkout 5xx 9 minutes later. The diff changes how cart pricing acquires database clients. This is a timing correlation; a rollback to v2.13.2 would test it.';
    citations = cite({ type: 'deployment', id: 'dep-checkout-2140' }, { type: 'problem', id: 'prb-aurora-connections' }, { type: 'problem', id: 'prb-checkout-5xx' });
  } else if (q.includes('24') || q.includes('today') || q.includes('summar') || context?.type === 'incident') {
    answer =
      'Last 24 hours: one resolved incident (catalog rollout short on tasks, 15 min) and one open critical incident since 40 minutes ago: checkout returns 5xx for about 7 % of requests while the Aurora writer is at 97 % of its connections. Redis latency is elevated but acknowledged. The storefront stayed available the whole time.';
    citations = cite({ type: 'incident', id: 'inc-2291' }, { type: 'incident', id: 'inc-2288' }, { type: 'synthetic', id: 'syn-storefront' });
  } else {
    answer =
      'Production is degraded. The most important problem is checkout-api returning HTTP 5xx (6.8 %, critical), which started 9 minutes after the v2.14.0 deployment, alongside the Aurora writer reaching 97 % of its connections. Observed facts point at connection pool exhaustion in the new pricing code; that remains a hypothesis until per-task connection counts confirm it.';
    citations = cite({ type: 'problem', id: 'prb-checkout-5xx' }, { type: 'investigation', id: 'inv-checkout-5xx' }, { type: 'deployment', id: 'dep-checkout-2140' });
  }
  return { id: `ans-${now}`, answer, generatedAt: now, citations, model: 'demo (canned answers)' };
}

export function findById<T extends { id: string }>(items: readonly T[], id: string): T | undefined {
  return items.find((item) => item.id === id);
}
