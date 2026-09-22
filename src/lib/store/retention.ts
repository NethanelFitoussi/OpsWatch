import 'server-only';
import { and, isNotNull, lt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { EVENT_KINDS, problems, type EventKind } from '../db/schema';
import { deleteRunsBefore } from './collector';
import { deleteEventsBefore } from './events';

/**
 * What OpsWatch forgets, and when (§9.4, §33.2).
 *
 * §33.2 draws the line this file implements: the open problem and its evidence are live state, always on and not a
 * storage-provider concern, but a *resolved* problem is history, and history beyond 30 days belongs behind the
 * historical storage provider rather than in the operational database. So a resolved problem is kept 30 days and
 * then deleted; its evidence follows by `on delete cascade`.
 */
export const RESOLVED_RETENTION_MS = 30 * 24 * 60 * 60_000;
/** An observation is noise once it is old: what existed in an account three months ago answers no question. */
export const OBSERVATION_EVENT_RETENTION_MS = 90 * 24 * 60 * 60_000;
/** 13 months, so a year-on-year comparison always has the year before it to compare with (§9.4). */
export const LIFECYCLE_EVENT_RETENTION_MS = 396 * 24 * 60 * 60_000;
/** How long System status keeps the record of what the collector did. */
export const COLLECTOR_RUN_RETENTION_MS = 30 * 24 * 60 * 60_000;

export const OBSERVATION_EVENT_KINDS = [
  'resource_appeared',
  'resource_disappeared',
  'collector_job_capped',
  'collector_job_failed',
] as const satisfies readonly EventKind[];

/** Everything that is not an observation is the lifecycle of a problem, and is kept far longer. */
const LIFECYCLE_EVENT_KINDS = EVENT_KINDS.filter(
  (kind) => !(OBSERVATION_EVENT_KINDS as readonly EventKind[]).includes(kind),
);

export type RetentionReport = {
  resolvedProblems: number;
  observationEvents: number;
  lifecycleEvents: number;
  collectorRuns: number;
};

/**
 * One pass of forgetting, reported rather than silent: System status shows what a run removed, so an operator who
 * notices history is missing can see that retention took it rather than suspecting a bug.
 *
 * It never deletes an incident. §9.4 keeps incidents "with an admin purge", and no admin purge exists yet — so
 * deleting one here would destroy something the product has not offered to destroy.
 */
export function runRetention(db: Db, nowMs: number): RetentionReport {
  const resolvedProblems = db
    .delete(problems)
    .where(and(isNotNull(problems.resolvedAt), lt(problems.resolvedAt, nowMs - RESOLVED_RETENTION_MS)))
    .run().changes;
  return {
    resolvedProblems,
    observationEvents: deleteEventsBefore(db, nowMs - OBSERVATION_EVENT_RETENTION_MS, OBSERVATION_EVENT_KINDS),
    lifecycleEvents: deleteEventsBefore(db, nowMs - LIFECYCLE_EVENT_RETENTION_MS, LIFECYCLE_EVENT_KINDS),
    collectorRuns: deleteRunsBefore(db, nowMs - COLLECTOR_RUN_RETENTION_MS),
  };
}
