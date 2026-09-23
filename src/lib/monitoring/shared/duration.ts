/**
 * How long something has been going on, in words a person reads at a glance.
 *
 * Client-safe and pure. "for 1,643 minutes" is technically exact and operationally useless: an operator
 * scanning six problems needs to know this one has been running over a day, and arithmetic is not part of
 * reading a list.
 *
 * The unit is chosen by magnitude and the caller renders it, so the sentence is translated rather than
 * assembled from English fragments.
 */
export type Duration = { unit: 'minutes' | 'hours' | 'days'; value: number };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function durationSince(fromMs: number, nowMs: number): Duration {
  const elapsed = Math.max(0, nowMs - fromMs);
  // Under two hours, minutes are what somebody acts on: "for 40 minutes" is a different decision from
  // "for 2 hours", and rounding the first to "1 hour" throws the difference away.
  if (elapsed < 2 * HOUR) return { unit: 'minutes', value: Math.max(1, Math.round(elapsed / MINUTE)) };
  if (elapsed < 2 * DAY) return { unit: 'hours', value: Math.round(elapsed / HOUR) };
  return { unit: 'days', value: Math.round(elapsed / DAY) };
}

/**
 * Which kind of thing a detector is about, from its id.
 *
 * `alb_elb_5xx_count` tells a reader nothing; "ALB" tells them where to look. The detector id is still on
 * the page — it is what a support conversation and an API filter use — but it is not the word that has to
 * carry the meaning.
 */
export function familyOf(kind: string): 'alb' | 'ecs' | 'rds' | 'alarm' | 'synthetic' | 'error' | 'slo' | 'other' {
  if (kind.startsWith('alb_')) return 'alb';
  if (kind.startsWith('ecs_')) return 'ecs';
  if (kind.startsWith('rds_') || kind.startsWith('aurora_')) return 'rds';
  if (kind.startsWith('alarm_')) return 'alarm';
  if (kind.startsWith('synthetic_') || kind === 'cert_expiring') return 'synthetic';
  if (kind.startsWith('error_group_')) return 'error';
  if (kind.startsWith('slo_')) return 'slo';
  return 'other';
}

/**
 * The detector kinds that have a short, human name in `Insights.headline`.
 *
 * Shared by the list and the detail so the two cannot drift: a kind that has a headline in one place and a
 * raw id in the other is the kind of inconsistency nobody notices until a reader does.
 */
export const HEADLINE_KINDS: ReadonlySet<string> = new Set([
  'ecs_tasks_below_desired',
  'ecs_cpu_high',
  'ecs_memory_high',
  'ecs_rollout_failed',
  'ecs_rollout_stuck',
  'rds_cpu_high',
  'rds_freeable_memory_low',
  'aurora_replica_lag',
  'alb_5xx_rate',
  'alb_elb_5xx_count',
  'alb_unhealthy_hosts',
  'alarm_firing',
  'synthetic_down',
  'synthetic_slow',
  'cert_expiring',
  'slo_burn_fast',
  'slo_burn_slow',
  'error_group_new',
  'error_group_spike',
]);

/** The headline key for a kind, falling back rather than rendering a detector id at a reader. */
export function headlineKey(kind: string): string {
  return HEADLINE_KINDS.has(kind) ? kind : 'unknown';
}
