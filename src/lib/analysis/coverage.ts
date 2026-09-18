import 'server-only';
import type { MonitoringFailure } from '../monitoring/result';

/** Per page load (amendment 11). */
export const REPORT_METRIC_QUERY_CAP = 300;
/** Per audit run, split so no family can starve another. */
export const AUDIT_METRIC_QUERY_CAP = 500;
export const AUDIT_BUDGET = { ecs: 200, rds: 150, alb: 90, logs: 60 } as const;
/**
 * RDS is budgeted at three queries because Aurora readers add AuroraReplicaLag to CPU and FreeableMemory;
 * instances that are not readers spend two, so the cap is conservative on purpose.
 */
export const AUDIT_QUERIES_PER = { ecs: 2, rds: 3, alb: 3, logs: 1 } as const;
/** One Performance Insights call per instance is the second axis of the budget; this bounds it. */
export const QUERIES_MAX_INSTANCES = 50;
export const AUDIT_MAX_PI_CALLS = 20;

export type Coverage = { covered: number; total: number; truncated: boolean };

export function coverageOf(covered: number, total: number): Coverage {
  return { covered, total, truncated: covered < total };
}

export function capResources<T>(resources: readonly T[], queriesPerResource: number, cap: number): { included: T[]; excluded: T[]; coverage: Coverage } {
  const limit = queriesPerResource <= 0 ? resources.length : Math.max(0, Math.floor(cap / queriesPerResource));
  const included = resources.slice(0, limit);
  return { included, excluded: resources.slice(limit), coverage: coverageOf(included.length, resources.length) };
}

export type NotCoveredReason = 'cap' | 'pi_disabled' | 'no_resource_id' | 'unknown_class' | 'denied' | 'throttled' | 'error';
export type NotCovered = { resource: string; reason: NotCoveredReason; code: string | null; action: string | null };

export function notCoveredFromFailure(resource: string, failure: MonitoringFailure): NotCovered {
  return { resource, reason: failure.reason, code: failure.code, action: failure.action };
}

export function notCovered(resource: string, reason: Exclude<NotCoveredReason, 'denied' | 'throttled' | 'error'>): NotCovered {
  return { resource, reason, code: null, action: null };
}

const REASON_ORDER: Record<NotCoveredReason, number> = { denied: 0, throttled: 1, error: 2, no_resource_id: 3, unknown_class: 4, pi_disabled: 5, cap: 6 };

export function sortNotCovered(rows: readonly NotCovered[]): NotCovered[] {
  return [...rows].sort((a, b) => REASON_ORDER[a.reason] - REASON_ORDER[b.reason] || a.resource.localeCompare(b.resource, 'en'));
}
