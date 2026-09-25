import 'server-only';
import type { Db } from '../db/client';
import type { ProblemRow } from '../db/schema';
import { enabledLogSources, pageErrorGroups } from '../store/errors';
import { earliestProblemAt, pastOccurrences } from '../store/problems';

/**
 * The investigation workspace (INV-5, §R).
 *
 * The problem page already answers what happened, how bad, why OpsWatch decided that and what to look
 * at. What it could not answer is the two questions an operator asks next:
 *
 *   **Has this happened before, and what happened last time?**
 *   **Where do I go and read the actual log lines?**
 *
 * Both are answerable from rows that already exist, and neither is answerable by guessing — so both
 * carry the shape of what is missing when it is missing. "No earlier occurrence" is stated beside how far
 * back the record goes, because on an installation that has been running for a day it means nothing.
 */

/** How many earlier occurrences are listed. A history, not an archive: the rest is the Problems page. */
export const PAST_LIMIT = 5;
/** How many error groups are listed beside a problem. */
const RELATED_ERROR_LIMIT = 5;

type PastOccurrence = {
  id: string;
  firstSeenAt: number;
  resolvedAt: number;
  /** How long it stayed open. Always known here, because only resolved occurrences are listed. */
  durationMs: number;
  severity: ProblemRow['severity'];
  acknowledged: boolean;
};

type RelatedError = {
  id: string;
  message: string;
  firstSeenAt: number;
  lastSeenAt: number;
  status: string;
};

export type Workspace = {
  /** Earlier, resolved occurrences of the same dedupe key, newest first. */
  past: PastOccurrence[];
  /**
   * The earliest problem this installation ever recorded, or null when it has recorded none.
   *
   * It is what makes "this has not happened before" mean anything: on an instance that started yesterday
   * it means nothing at all, and the page says so rather than implying a clean record.
   */
  recordedSince: number | null;
  /** The typical time to resolve, from the occurrences listed, or null with fewer than two. */
  typicalDurationMs: number | null;
  /**
   * Error groups on the same service, or `null` when no log source is switched on for it.
   *
   * `null` and `[]` are different answers: nothing is being read, against nothing was found. The page
   * renders them as different sentences, which is the whole of §2.6 in one field.
   */
  errors: RelatedError[] | null;
  /**
   * The log groups a "read the logs" link would open, or `[]` when none is switched on.
   *
   * Only groups OpsWatch is already reading: offering to search a log group nobody selected would be
   * offering to spend money on a guess about where this service writes.
   */
  logGroups: string[];
};

/**
 * The middle value of a list of durations.
 *
 * Median rather than mean: one occurrence that stayed open over a weekend would drag an average into
 * uselessness, and the number is there to answer "how long does this usually take", not "how long has
 * this cost me in total".
 */
export function medianDuration(durations: readonly number[]): number | null {
  if (durations.length < 2) return null;
  const sorted = [...durations].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
}

export function readWorkspace(db: Db, problem: ProblemRow, limit = PAST_LIMIT): Workspace {
  // Same dedupe key, already resolved, and opened before this one: the same fault, previous times.
  // Keyed rather than kind-and-subject because the key is what the engine itself treats as one identity.
  const past = pastOccurrences(db, { key: problem.key, before: problem.firstSeenAt }, limit).map((row) => ({
      id: row.id,
      firstSeenAt: row.firstSeenAt,
      resolvedAt: row.resolvedAt as number,
      durationMs: (row.resolvedAt as number) - row.firstSeenAt,
      severity: row.severity,
      acknowledged: row.acknowledgedAt !== null,
    }));


  const sources = enabledLogSources(db, problem.connectionId, problem.scope);
  // A source with no service named reads every group it is pointed at, so it belongs to any service here.
  const forService = sources.filter((source) => source.serviceId === null || source.serviceId === problem.serviceId);

  const errors =
    forService.length === 0
      ? null
      : pageErrorGroups(
          db,
          {
            connectionId: problem.connectionId,
            scope: problem.scope,
            ...(problem.serviceId === null ? {} : { serviceId: problem.serviceId }),
            sinceMs: problem.firstSeenAt,
          },
          null,
          RELATED_ERROR_LIMIT,
        ).items.map((row) => ({
          id: row.id,
          message: row.sampleMessage,
          firstSeenAt: row.firstSeenAt,
          lastSeenAt: row.lastSeenAt,
          status: row.status,
        }));

  return {
    past,
    // This environment's own record: measuring a problem in an account added this morning against
    // another account's six months of history would imply a clean record nobody has.
    recordedSince: earliestProblemAt(db, { connectionId: problem.connectionId, scope: problem.scope }),
    typicalDurationMs: medianDuration(past.map((occurrence) => occurrence.durationMs)),
    errors,
    logGroups: forService.map((source) => source.logGroup),
  };
}
