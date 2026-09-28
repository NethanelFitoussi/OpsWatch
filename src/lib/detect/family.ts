/**
 * Which family answers for each detector.
 *
 * It lives in the pure detect layer rather than beside the collector job because two very different callers
 * need it: the job, to decide whether a live problem's family was actually read this cycle (§33.5), and the
 * report service, to scope a section's report to the problems that belong to it. A read service must not
 * have to import the collector — and everything it would drag in — to answer that.
 */
import { AWS_FAMILIES, GCP_FAMILIES, type AwsFamily, type MonitoringFamily } from '../monitoring/shared/families';

/** The families the detect job reads, in the order the product shows them. Re-exported, never re-declared. */
export const PROBLEM_FAMILIES = AWS_FAMILIES;
export type ProblemFamily = AwsFamily;

/** Every family of every cloud, which is what a problem row's kind may belong to. */
export const ALL_PROBLEM_FAMILIES: readonly MonitoringFamily[] = [...AWS_FAMILIES, ...GCP_FAMILIES];

const FAMILY_OF: Record<string, MonitoringFamily> = {
  // Google's, filed under the family that reads them. A kind with no family is never evaluated, so
  // its problems could neither resolve themselves nor be reported as unevaluated — they would simply
  // sit there.
  gcp_incident_open: 'gcp_alerts',
  ecs_tasks_below_desired: 'ecs',
  ecs_cpu_high: 'ecs',
  ecs_memory_high: 'ecs',
  ecs_rollout_failed: 'ecs',
  ecs_rollout_stuck: 'ecs',
  rds_cpu_high: 'rds',
  rds_freeable_memory_low: 'rds',
  aurora_replica_lag: 'rds',
  alb_5xx_rate: 'alb',
  alb_elb_5xx_count: 'alb',
  alb_unhealthy_hosts: 'alb',
  alarm_firing: 'alarms',
};

/** Null for a kind no family claims, which is how an unknown detector stays unevaluated rather than clear. */
export function familyOfKind(kind: string): MonitoringFamily | null {
  return FAMILY_OF[kind] ?? null;
}

/** Every detector kind belonging to a family, which is how a report scopes itself to its own section. */
/** Widened to any cloud's family: a report over a Google environment asks about `gcp_alerts`. */
export function kindsOfFamily(family: MonitoringFamily): string[] {
  return Object.keys(FAMILY_OF).filter((kind) => FAMILY_OF[kind] === family);
}

/**
 * How a family reads on Health: as bad as the worst **problem** it produced, or healthy with none.
 *
 * The problems rather than the raw insights that made them, because a problem's severity is the product's
 * considered answer — the detector's level passed through §33.7's score — and the raw insight's is not.
 * Reading the insight put "Critical · Something is seriously wrong" at the top of Health above a count
 * that said "Critical problems: 0", for one warning-level alarm: two ladders, one fact, and a reader left
 * to work out which of the two the product meant.
 *
 * `null` means nothing is wrong. The caller decides what that means, because "nothing wrong in a family
 * that was read" and "nothing wrong in a family nobody could read" are different answers (§2.6).
 */
export function familyStatusOf(problems: readonly { severity: string }[]): 'critical' | 'degraded' | null {
  if (problems.some((problem) => problem.severity === 'critical')) return 'critical';
  return problems.length > 0 ? 'degraded' : null;
}
