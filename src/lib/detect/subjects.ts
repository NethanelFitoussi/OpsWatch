import type { SubjectKind } from './key';
import type { InsightKind } from '../monitoring/shared/kinds';
import { AWS_INSIGHT_KINDS, GCP_INSIGHT_KINDS, type AwsInsightKind, type GcpInsightKind } from '../monitoring/shared/kinds';

/**
 * Which kind of thing each detector is about.
 *
 * **Per provider, then merged, and that is the whole decision.** `InsightKind` was a closed union of
 * AWS's twelve, and `SUBJECT_OF` an exhaustive `Record` over it — so the compiler guaranteed that
 * every detector had a subject type, and adding a kind without one would not build. That guarantee is
 * worth more than the convenience of one flat union, and widening the union naively would have thrown
 * it away: `Record<InsightKind, SubjectKind>` over a union of everything is satisfied by any map that
 * happens to cover it, and nothing then ties a *provider's* kinds to a *provider's* map.
 *
 * So each cloud keeps its own exhaustive record over its own kinds, and the merged map is built from
 * them. Nothing is lost: adding a Google kind without a subject type fails to compile in
 * `GCP_SUBJECT_OF`, exactly as adding an AWS one does in `AWS_SUBJECT_OF`. And each provider's
 * answers live beside that provider's rules rather than in one list nobody owns.
 */

/** The resource of an `ecs_*` insight *is* the service id. */
const AWS_SUBJECT_OF: Record<AwsInsightKind, SubjectKind> = {
  ecs_tasks_below_desired: 'service',
  ecs_cpu_high: 'service',
  ecs_memory_high: 'service',
  ecs_rollout_failed: 'service',
  ecs_rollout_stuck: 'service',
  rds_cpu_high: 'resource',
  rds_freeable_memory_low: 'resource',
  aurora_replica_lag: 'resource',
  alb_5xx_rate: 'resource',
  alb_elb_5xx_count: 'resource',
  alb_unhealthy_hosts: 'resource',
  alarm_firing: 'resource',
};

/**
 * Google's kinds.
 *
 * `resource`, because an open incident is about a thing Google named — an instance, a Cloud Run
 * revision, a bucket — and not about a service OpsWatch has mapped. Calling it `service` would put it
 * in a service graph nothing else in the product knows about.
 */
const GCP_SUBJECT_OF: Record<GcpInsightKind, SubjectKind> = {
  gcp_incident_open: 'resource',
};

export const SUBJECT_OF: Record<InsightKind, SubjectKind> = { ...AWS_SUBJECT_OF, ...GCP_SUBJECT_OF };

/** Every detector kind, in provider order. The merged map's keys, by construction. */
export const ALL_INSIGHT_KINDS: readonly InsightKind[] = [...AWS_INSIGHT_KINDS, ...GCP_INSIGHT_KINDS];
