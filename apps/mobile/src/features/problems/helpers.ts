/**
 * Pure helpers of the Problems experience: filter state → API filters, durations, and the factual phrasing of
 * deployment correlations and brief counts. No React here so everything is unit-testable.
 */
import type { ProblemFilters } from '@/api/client';
import type { Brief, DeploymentSummary, Evidence, ProblemDetail, ProblemStatus, ProblemSummary, Severity } from '@/api/contract';
import type { MessageKey, Translate } from '@/i18n';
import { formatDuration } from '@/lib/format';
import type { IconName } from '@/ui/layout';
import type { Tone } from '@/ui/theme';

export const STATUS_FILTERS = ['open', 'new', 'active', 'acknowledged', 'resolved', 'all'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const TIME_RANGES = ['1h', '6h', '24h', '7d', 'any'] as const;
export type TimeRange = (typeof TIME_RANGES)[number];

const HOUR = 3_600_000;
const RANGE_MS: Record<Exclude<TimeRange, 'any'>, number> = { '1h': HOUR, '6h': 6 * HOUR, '24h': 24 * HOUR, '7d': 7 * 24 * HOUR };

/** Chip values of the category filter are prefixed so their test ids never clash with the other filters. */
export const CATEGORY_ALL = 'cat:all';
export const categoryValue = (category: string) => `cat:${category}`;
export const categoryFromValue = (value: string): string | null => (value === CATEGORY_ALL ? null : value.slice(4));

export type ProblemFilterState = {
  status: StatusFilter;
  severities: Severity[];
  category: string | null;
  /** Epoch ms, computed once when the time range is chosen so the query key stays stable between renders. */
  since: number | null;
  service: string | null;
};

export const DEFAULT_FILTERS: ProblemFilterState = { status: 'open', severities: [], category: null, since: null, service: null };

export function sinceFor(range: TimeRange, now: number): number | null {
  return range === 'any' ? null : now - RANGE_MS[range];
}

/** Maps the screen's filter state to the query sent to the server. Unset filters are left out entirely. */
export function toProblemFilters(state: ProblemFilterState, options: { withCategory?: boolean } = {}): ProblemFilters {
  const filters: ProblemFilters = {};
  if (state.status !== 'all') filters.status = state.status;
  if (state.severities.length) filters.severity = [...state.severities].sort();
  if (state.service) filters.service = state.service;
  if (state.category && options.withCategory !== false) filters.category = state.category;
  if (state.since !== null) filters.since = state.since;
  return filters;
}

export function hasNarrowingFilters(state: ProblemFilterState): boolean {
  return state.severities.length > 0 || state.category !== null || state.since !== null || state.service !== null;
}

/** Categories present in the loaded problems, sorted, always keeping the selected one so it can be cleared. */
export function categoriesOf(problems: Pick<ProblemSummary, 'category'>[], selected: string | null): string[] {
  const set = new Set(problems.map((p) => p.category).filter(Boolean));
  if (selected) set.add(selected);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** How long the problem has lasted: until it was last seen once resolved, until now otherwise. */
export function problemDuration(problem: Pick<ProblemSummary, 'firstSeenAt' | 'lastSeenAt' | 'status'>, now: number): { ms: number; ongoing: boolean } {
  const ongoing = problem.status !== 'resolved';
  return { ms: Math.max(0, (ongoing ? now : problem.lastSeenAt) - problem.firstSeenAt), ongoing };
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
  return t(`${base}.${count === 1 ? 'one' : 'other'}` as MessageKey, { count });
}

export function occurrencesText(t: Translate, count: number | null): string | null {
  return count === null ? null : plural(t, 'problems.row.occurrences', count);
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
