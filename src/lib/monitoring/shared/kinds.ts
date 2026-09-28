/**
 * What a detector can say, per cloud.
 *
 * A leaf with no imports: the rules produce these, the detect layer maps them to subject types, the
 * family map files them, and none of those may import the others. Splitting by provider is what keeps
 * the exhaustiveness that `Record<AwsInsightKind, …>` gives — see `detect/subjects.ts` for why that
 * mattered more than one flat union.
 */

export const AWS_INSIGHT_KINDS = [
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
] as const;

/**
 * Google's, which is one: **an incident Google itself opened**.
 *
 * Deliberately not a set of thresholds mirroring the AWS ones. OpsWatch does not evaluate Google's
 * metrics and decide something is wrong — Google's own alerting policies do that, the operator wrote
 * them, and relaying their verdict is using the provider's evidence. Inventing a `gcp_cpu_high` with
 * an OpsWatch threshold would be manufacturing a health conclusion beside the one the project already
 * has, and the two would disagree.
 */
export const GCP_INSIGHT_KINDS = ['gcp_incident_open'] as const;

export type AwsInsightKind = (typeof AWS_INSIGHT_KINDS)[number];
export type GcpInsightKind = (typeof GCP_INSIGHT_KINDS)[number];
export type InsightKind = AwsInsightKind | GcpInsightKind;
