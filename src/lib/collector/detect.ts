import 'server-only';
import { familyOfKind, familyStatusOf } from '../detect/family';
import { applyCycle } from '../detect/lifecycle';
import { outcomesFromInsights, type EvaluatedPair } from '../detect/aws';
import type { SubjectOutcome, SubjectRef } from '../detect/types';
import type { Db } from '../db/client';
import type { InsightKind } from '../monitoring/insights';
import { monitoringProvider } from '../monitoring/provider-registry';
import type { Provider } from '../connections/types';
import { recordFamilySnapshot } from '../store/health';
import { applyTransitions, listLiveProblems, listRecentlyResolved } from '../store/problems';
import { runAlertCycle } from './alerts';
import { runIncidentCycle } from './incidents';
import { RESOLVED_RETENTION_MS } from '../store/retention';
import type { JobOutcome } from './runner';

/**
 * The `detect` job: the cycle that turns what the Stage 2 rules see into persisted problems.
 *
 * It costs no extra AWS request beyond what a page would have made — §9.5's point, and the reason D4 has it
 * on for a fresh install. It reads the same four families the Insights page reads, through the same cache.
 *
 * The care in here is all about **§33.5**. A family that fails to load leaves its subjects *not evaluated*,
 * which is not the same as clear: a problem whose subject nobody could look at must not resolve itself. So
 * the job reports, per live problem, whether its family was actually read this cycle.
 */

// The mapping itself lives in `lib/detect/family.ts`: the report service needs it too, and must not import
// the collector - and everything it drags in - to get it.
export { familyOfKind };

export type DetectJobInput = {
  db: Db;
  connectionId: string;
  scope: string;
  nowMs: number;
  /** Which cloud this connection is to. Defaulted so every existing caller keeps its meaning. */
  provider?: Provider;
};

export async function runDetectJob(input: DetectJobInput): Promise<JobOutcome> {
  /*
   * Which families this connection's provider has, and who reads them.
   *
   * The seam of the whole multi-cloud model is right here and nowhere else: everything below this
   * point — the outcomes, the problem lifecycle, the family snapshots, the alert and incident cycles —
   * works on `Insight` and problem rows and has no AWS type in it. A second provider is a second set
   * of families and a loader for them, not a second monitoring application.
   */
  const monitoring = monitoringProvider(input.provider ?? 'aws');
  if (monitoring.loadFamily === null || monitoring.families.length === 0 || monitoring.resolveTarget === null) {
    // A provider with nothing to read is not a failed cycle. It is a cycle with no families, and
    // recording it as a failure would put a red mark on a connection that is working as designed.
    return { covered: 0, total: 0, truncated: false };
  }

  // This provider's own resolver. It used to be AWS's AssumeRole for every connection, which was
  // harmless only while nothing but AWS had families — the first Google family would have made every
  // Google cycle throw `connection_unavailable` before a single Google request was attempted.
  const target = await monitoring.resolveTarget({ connectionId: input.connectionId, region: input.scope });
  if (!target.ok) {
    // Nothing could be read, so nothing is claimed. Every live problem stays exactly as it was, and the
    // failure is what the run records — not a cycle in which everything quietly looked healthy.
    throw new Error('connection_unavailable');
  }

  const families = await Promise.all(
    monitoring.families.map(async (family) => ({
      family,
      result: await monitoring.loadFamily!(family, target.data, input.nowMs),
    })),
  );
  /*
   * Which families were read **in full**. A partial read is deliberately not in here: silence about a
   * subject only means "gone" when everything was looked at, and a family that stopped at a page
   * boundary cannot tell an absent problem from one further down the list. Its problems stay
   * unevaluated rather than resolving themselves.
   */
  const read = new Set(families.filter(({ result }) => result.ok && result.data.truncated !== true).map(({ family }) => family));
  const insights = families.flatMap(({ result }) => (result.ok ? result.data.insights : []));

  const live = listLiveProblems(input.db, input.connectionId, input.scope);

  // §33.5's three outcomes, decided by whether the family behind each live problem was actually read.
  const evaluated: EvaluatedPair[] = [];
  const notEvaluated: EvaluatedPair[] = [];
  for (const { row } of live) {
    const family = familyOfKind(row.kind);
    const subject: SubjectRef = {
      type: row.subjectType,
      id: row.subjectId,
      name: row.subjectName,
      serviceId: row.serviceId,
    };
    const pair: EvaluatedPair = { subject, kinds: [row.kind as InsightKind] };
    (family !== null && read.has(family) ? evaluated : notEvaluated).push(pair);
  }

  const outcomes: SubjectOutcome[] = outcomesFromInsights({
    insights,
    evaluated,
    notEvaluated,
    nowMs: input.nowMs,
    // Persistence the rules cannot carry: how long this subject has actually been breaching, from the row.
    breachingMinutes: (kind, subjectId) => {
      const found = live.find(({ row }) => row.kind === kind && row.subjectId === subjectId);
      return found ? Math.max(0, Math.round((input.nowMs - found.row.firstSeenAt) / 60_000)) : undefined;
    },
  });

  const transitions = applyCycle({
    connectionId: input.connectionId,
    scope: input.scope,
    live: live.map(({ live: projection }) => projection),
    // Everything still retained, not merely what is still reopenable: the lifecycle applies the two-hour
    // window itself, and it needs the older rows too so a successor can carry `previousProblemId`. Retention
    // deletes a resolved problem after thirty days, so this set is bounded by that and nothing else.
    resolvedInWindow: listRecentlyResolved(input.db, input.connectionId, input.scope, input.nowMs - RESOLVED_RETENTION_MS),
    cycle: { at: input.nowMs, outcomes, failed: [] },
    nowMs: input.nowMs,
  });

  applyTransitions(input.db, { connectionId: input.connectionId, scope: input.scope, source: monitoring.provider }, transitions);

  const liveNow = listLiveProblems(input.db, input.connectionId, input.scope).map(({ row }) => row);

  // What each family looked like, written down so Health can answer instantly and without AWS. Written
  // *after* the cycle, because the severities that belong on Health are the ones the problems ended up
  // with. A family that could not be read says so, rather than being recorded as healthy — §2's rule that
  // the two never look alike.
  for (const { family, result } of families) {
    const worst = result.ok ? familyStatusOf(liveNow.filter((row) => familyOfKind(row.kind) === family)) : null;
    recordFamilySnapshot(input.db, {
      connectionId: input.connectionId,
      scope: input.scope,
      family,
      // A partial read with nothing wrong in what it saw is `unknown`, not `healthy`: the trouble may
      // be in the part it did not reach. What it *did* see still counts, so a partial read that found
      // something reports what it found.
      status: result.ok ? (worst ?? (result.data.truncated === true ? 'unknown' : 'healthy')) : 'unknown',
      total: result.ok ? result.data.total : null,
      affected: result.ok ? result.data.affected : null,
      readAt: input.nowMs,
      unavailableReason: result.ok ? null : result.reason,
      unavailableCode: result.ok ? null : (result.code ?? null),
    });
  }

  // §15, on the same rows: an alert is a statement about what is live now, so it is decided here rather
  // than by a job that would see a different set five minutes later.
  runAlertCycle(input.db, { connectionId: input.connectionId, scope: input.scope, provider: monitoring.provider }, liveNow, input.nowMs);

  // §16, on the rows this cycle just wrote. Evaluating it as a job of its own five minutes later would open
  // incidents for trouble that had already passed.
  runIncidentCycle(input.db, { connectionId: input.connectionId, scope: input.scope }, liveNow, input.nowMs);

  return {
    // How much of the environment this cycle actually saw. A family that failed to load means it saw less
    // than all of it, which System status shows rather than hides.
    covered: read.size,
    // This provider's families, not AWS's. Counting AWS's four while looping over another provider's
    // two would report a cycle that read everything it has as truncated, for ever.
    total: monitoring.families.length,
    truncated: read.size < monitoring.families.length,
  };
}
