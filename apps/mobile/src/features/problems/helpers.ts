/**
 * Pure helpers of the Problems experience: filter state → API filters, durations, and the factual phrasing of
 * deployment correlations and brief counts. No React here so everything is unit-testable.
 */
import type { ProblemFilters } from '@/api/client';
import { SEVERITIES, type Brief, type DeploymentSummary, type Evidence, type ProblemDetail, type ProblemStatus, type ProblemSummary, type Severity } from '@/api/contract';
import type { MessageKey, Translate } from '@/i18n';
import { formatDuration, formatMetric } from '@/lib/format';
import type { IconName } from '@/ui/layout';
import type { Tone } from '@/ui/theme';

export const STATUS_FILTERS = ['open', 'new', 'active', 'acknowledged', 'resolved', 'all'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const TIME_RANGES = ['1h', '6h', '24h', '7d', 'any'] as const;
export type TimeRange = (typeof TIME_RANGES)[number];

const HOUR = 3_600_000;
const RANGE_MS: Record<Exclude<TimeRange, 'any'>, number> = { '1h': HOUR, '6h': 6 * HOUR, '24h': 24 * HOUR, '7d': 7 * 24 * HOUR };

export type ProblemFilterState = {
  status: StatusFilter;
  severities: Severity[];
  /** Epoch ms, computed once when the time range is chosen so the query key stays stable between renders. */
  since: number | null;
  service: string | null;
};

export const DEFAULT_FILTERS: ProblemFilterState = { status: 'open', severities: [], since: null, service: null };

/**
 * The severity filter lives in the route (`/problems?severity=critical`), so Home can open the list already narrowed
 * and the chips stay the only way to change it. Unknown values are dropped; the result is deduplicated and sorted so
 * the query key is stable.
 */
export function parseSeverities(value: string | string[] | undefined): Severity[] {
  const raw = Array.isArray(value) ? value.join(',') : (value ?? '');
  const found = raw.split(',').map((part) => part.trim()).filter((part): part is Severity => (SEVERITIES as readonly string[]).includes(part));
  return [...new Set(found)].sort();
}

export function sinceFor(range: TimeRange, now: number): number | null {
  return range === 'any' ? null : now - RANGE_MS[range];
}

/**
 * Maps the screen's filter state to the query sent to the server. Unset filters are left out entirely, and only
 * parameters the contract declares in `LIST_FILTERS` are ever sent: an undeclared one is a 400, not a no-op.
 */
export function toProblemFilters(state: ProblemFilterState): ProblemFilters {
  const filters: ProblemFilters = {};
  if (state.status !== 'all') filters.status = state.status;
  if (state.severities.length) filters.severity = [...state.severities].sort();
  if (state.service) filters.service = state.service;
  if (state.since !== null) filters.since = state.since;
  return filters;
}

export function hasNarrowingFilters(state: ProblemFilterState): boolean {
  return state.severities.length > 0 || state.since !== null || state.service !== null;
}


/** How long the problem has lasted: until it was last seen once resolved, until now otherwise. */
export function problemDuration(problem: Pick<ProblemSummary, 'firstSeenAt' | 'lastSeenAt' | 'status'>, now: number): { ms: number; ongoing: boolean } {
  const ongoing = problem.status !== 'resolved';
  return { ms: Math.max(0, (ongoing ? now : problem.lastSeenAt) - problem.firstSeenAt), ongoing };
}

/** "ongoing for 3 h 12 min" / "lasted 15 min": the tense says by itself whether it is still happening. */
export function durationText(t: Translate, problem: Pick<ProblemSummary, 'firstSeenAt' | 'lastSeenAt' | 'status'>, now: number): string {
  const { ms, ongoing } = problemDuration(problem, now);
  return t(ongoing ? 'problems.duration.ongoingFor' : 'problems.duration.lasted', { duration: formatDuration(ms) });
}

/** "Started 9 min after deployment v2.14.0 of checkout-api": timing stated as a fact, never as a cause. */
export function deploymentCorrelationText(t: Translate, deployment: Pick<DeploymentSummary, 'version' | 'service'>, minutesBeforeProblem: number): string {
  return t('problems.deployments.after', {
    delay: formatDuration(Math.max(0, minutesBeforeProblem) * 60_000),
    version: deployment.version,
    service: deployment.service.label ?? deployment.service.id,
  });
}

function plural(t: Translate, base: 'problems.brief.critical' | 'problems.brief.warnings' | 'problems.brief.healthy' | 'problems.row.occurrences', count: number): string {
  // Thousands are grouped ("3,712 occurrences"), so a big count stays readable at a glance.
  return t(`${base}.${count === 1 ? 'one' : 'other'}` as MessageKey, { count: formatMetric(count, 'count') });
}

export function occurrencesText(t: Translate, count: number | null): string | null {
  return count === null ? null : plural(t, 'problems.row.occurrences', count);
}

/**
 * The filters currently narrowing the list, spelled out. The empty state uses it so an empty list always says why it
 * is empty; the default "open problems" view produces nothing.
 */
export function activeFilterLabels(t: Translate, state: ProblemFilterState, range: TimeRange, serviceLabel: string | null): string[] {
  const labels: string[] = [];
  if (state.status !== DEFAULT_FILTERS.status) labels.push(`${t('filter.status')}: ${state.status === 'all' ? t('filter.all') : t(`status.${state.status}`)}`);
  if (state.severities.length) labels.push(`${t('filter.severity')}: ${state.severities.map((severity) => t(`severity.${severity}`)).join(', ')}`);
  if (range !== 'any') labels.push(`${t('filter.time')}: ${t(`time.range.${range}`)}`);
  if (state.service) labels.push(`${t('filter.service')}: ${serviceLabel ?? state.service}`);
  return labels;
}

/** "2 critical · 4 warnings · 18 healthy services". A missing healthy count is "no data", never 0. */
export function briefCountsLine(t: Translate, counts: Brief['counts']): string {
  return [
    plural(t, 'problems.brief.critical', counts.critical),
    plural(t, 'problems.brief.warnings', counts.warning),
    counts.healthyServices === null ? t('problems.brief.healthy.noData') : plural(t, 'problems.brief.healthy', counts.healthyServices),
  ].join(' · ');
}

/** "Production: DEGRADED". */
export function briefHeadline(t: Translate, environmentName: string, status: Brief['status']): string {
  return t('brief.production', { environment: environmentName, status: t(`health.${status}`).toUpperCase() });
}

export const STATUS_META: Record<ProblemStatus, { icon: IconName; tone: Tone }> = {
  new: { icon: 'sparkles-outline', tone: 'info' },
  active: { icon: 'radio-button-on', tone: 'unknown' },
  acknowledged: { icon: 'eye-outline', tone: 'unknown' },
  resolved: { icon: 'checkmark-done', tone: 'healthy' },
};

export const TREND_ICONS: Record<NonNullable<ProblemSummary['trend']>, IconName> = {
  rising: 'trending-up',
  falling: 'trending-down',
  stable: 'remove',
};

/**
 * Everything the problem knows, for the evidence sections. Possible causes are always shown as hypotheses whatever
 * kind the server gave them, and an item present in both lists appears once, as a hypothesis.
 */
export function problemEvidence(problem: Pick<ProblemDetail, 'evidence' | 'possibleCauses'>): Evidence[] {
  const seen = new Set<string>();
  const result: Evidence[] = [];
  // Causes first: when an id is in both lists, the more cautious label (hypothesis) wins.
  for (const item of [...problem.possibleCauses.map((c) => ({ ...c, kind: 'hypothesis' as const })), ...problem.evidence]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}
