import 'server-only';
import type { Db } from '../db/client';
import type { ErrorGroupRow } from '../db/schema';
import { median } from '../detect/baseline';
import { ERROR_KINDS, errorOutcomes, type ErrorGroupFacts } from '../detect/errors';
import { applyCycle } from '../detect/lifecycle';
import type { SubjectOutcome } from '../detect/types';
import { HOUR_MS, hourOf, occurrenceSeries, pageErrorGroups, setErrorProblem } from '../store/errors';
import { applyTransitions, listLiveProblems, listRecentlyResolved } from '../store/problems';
import { RESOLVED_RETENTION_MS } from '../store/retention';

/**
 * Turning error groups into problems (§4.4, ERR-9).
 *
 * The detectors have existed since the errors work landed and nothing ran them: a group could appear, spike
 * and be collected without ever becoming a problem, which is the only form an error takes that anybody is
 * told about. This is the cycle that runs them, on the same lifecycle as every other detector — so an error
 * problem opens, reopens, flaps and resolves exactly like a failing service rather than being a second kind
 * of thing living beside problems.
 */

/** How many groups one cycle judges. Bounded, because a noisy environment must not unbound the pass. */
const ERROR_DETECT_LIMIT = 200;

/** The window §4.4 counts occurrences over when deciding whether a group is spiking. */
const SPIKE_WINDOW_MS = HOUR_MS;

/**
 * How far back the baseline is taken from, and the trade it represents.
 *
 * §4.4 says "the baseline for this hour of the week". A group that has existed for four weeks offers four
 * observations per hour-of-week bucket, which is fewer than §8 will stand behind for anything else — so
 * this takes the median hourly count over the last seven days instead. That is a weaker claim than the
 * spec's and a **much** stronger one than a threshold: it survives a spike, because a median does, and it
 * is computed from at least a hundred observations rather than four.
 */
export const BASELINE_WINDOW_MS = 7 * 24 * HOUR_MS;

export type ErrorDetectContext = { connectionId: string; scope: string };

/**
 * The usual hourly count for a group, or null when there is not enough history to say.
 *
 * The hour being judged is excluded: including it would let a spike raise the baseline it is measured
 * against, which is the arithmetic equivalent of grading your own homework. Null rather than zero for a
 * group nobody has watched long enough — `isSpiking` reads null as "not spiking", which is the honest
 * answer for a group with a short history rather than the alarming one.
 */
export function baselineFor(db: Db, groupId: string, nowMs: number): number | null {
  // The hour being judged is left out so the arithmetic is right by construction: a window must not be
  // measured against a baseline containing it. A mutation showed the exclusion is invisible in practice —
  // one bucket cannot move a median taken over at least twenty-four — which is a property of the median
  // rather than a reason to include it.
  const current = hourOf(nowMs);
  const buckets = occurrenceSeries(db, groupId, nowMs - BASELINE_WINDOW_MS).filter((point) => point.at < current);
  // Fewer than a day's worth of hours is a history, not a baseline.
  if (buckets.length < 24) return null;
  return median(buckets.map((point) => point.count));
}

/** Occurrences in the window §4.4 judges, from the same hourly rollups the baseline is taken from. */
export function occurrencesIn(db: Db, groupId: string, nowMs: number): number {
  return occurrenceSeries(db, groupId, nowMs - SPIKE_WINDOW_MS)
    .filter((point) => point.at >= hourOf(nowMs - SPIKE_WINDOW_MS))
    .reduce((total, point) => total + point.count, 0);
}

function factsOf(db: Db, row: ErrorGroupRow, nowMs: number, href: string): ErrorGroupFacts {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    serviceId: row.serviceId,
    exceptionType: row.exceptionType,
    sampleMessage: row.sampleMessage,
    status: row.status,
    firstSeenAt: row.firstSeenAt,
    statusSince: row.statusSince,
    occurrences: occurrencesIn(db, row.id, nowMs),
    baseline: baselineFor(db, row.id, nowMs),
    href,
  };
}

export type ErrorDetectResult = { judged: number; linked: number };

export function runErrorDetectCycle(db: Db, context: ErrorDetectContext, nowMs: number): ErrorDetectResult {
  const groups = pageErrorGroups(db, { connectionId: context.connectionId, scope: context.scope }, null, ERROR_DETECT_LIMIT).items;
  if (groups.length === 0) return { judged: 0, linked: 0 };

  const outcomes: SubjectOutcome[] = groups.flatMap((row) =>
    errorOutcomes(
      factsOf(db, row, nowMs, `/c/${context.connectionId}/${context.scope}/errors/groups/${row.id}`),
      nowMs,
    ),
  );

  const live = listLiveProblems(db, context.connectionId, context.scope);
  const transitions = applyCycle({
    connectionId: context.connectionId,
    scope: context.scope,
    // Only the error problems. The lifecycle walks outcomes rather than live rows, so an unjudged problem
    // would produce no transition either way — this narrows what it looks up, and keeps one cycle's
    // decisions about one family of subjects where a reader can see them.
    live: live.filter(({ row }) => row.subjectType === 'error_group').map(({ live: projection }) => projection),
    resolvedInWindow: listRecentlyResolved(db, context.connectionId, context.scope, nowMs - RESOLVED_RETENTION_MS),
    cycle: { at: nowMs, outcomes, failed: [] },
    nowMs,
  });
  applyTransitions(db, { connectionId: context.connectionId, scope: context.scope }, transitions);

  // ERR-9: the link, written from what is live now rather than from the transitions — a group whose problem
  // was already open keeps its link, and one whose problem resolved loses it rather than pointing at a row
  // that no longer says anything about today.
  //
  // A group can be both new and spiking, and §4.4 says both are worth raising. The link points at the
  // **worse** of them: `ERROR_KINDS` is ordered spike first, so a reader following the link from an error
  // arrives at the problem that would have woken somebody rather than the one that merely noted it.
  const openByFingerprint = new Map<string, string>();
  for (const kind of [...ERROR_KINDS].reverse()) {
    for (const { row } of listLiveProblems(db, context.connectionId, context.scope)) {
      if (row.subjectType !== 'error_group' || row.kind !== kind) continue;
      openByFingerprint.set(row.subjectId, row.id);
    }
  }

  let linked = 0;
  for (const row of groups) {
    const problemId = openByFingerprint.get(row.fingerprint) ?? null;
    if (problemId === row.problemId) continue;
    setErrorProblem(db, row.id, problemId);
    if (problemId !== null) linked += 1;
  }

  return { judged: groups.length, linked };
}
