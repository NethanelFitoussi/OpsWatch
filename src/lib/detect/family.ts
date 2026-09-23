/**
 * Which family answers for each detector.
 *
 * It lives in the pure detect layer rather than beside the collector job because two very different callers
 * need it: the job, to decide whether a live problem's family was actually read this cycle (§33.5), and the
 * report service, to scope a section's report to the problems that belong to it. A read service must not
 * have to import the collector — and everything it would drag in — to answer that.
 */

/** The four families the detect job reads, in the order the product shows them. */
export const PROBLEM_FAMILIES = ['ecs', 'rds', 'alb', 'alarms'] as const;
export type ProblemFamily = (typeof PROBLEM_FAMILIES)[number];

const FAMILY_OF: Record<string, ProblemFamily> = {
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
export function familyOfKind(kind: string): ProblemFamily | null {
  return FAMILY_OF[kind] ?? null;
}

/** Every detector kind belonging to a family, which is how a report scopes itself to its own section. */
export function kindsOfFamily(family: ProblemFamily): string[] {
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
