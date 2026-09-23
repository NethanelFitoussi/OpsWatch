import 'server-only';
import { familyOfKind } from '../detect/family';
import { applyCycle } from '../detect/lifecycle';
import { outcomesFromInsights, type EvaluatedPair } from '../detect/aws';
import type { SubjectOutcome, SubjectRef } from '../detect/types';
import type { Db } from '../db/client';
import type { InsightKind } from '../monitoring/insights';
import { INSIGHT_FAMILIES, loadFamily } from '../monitoring/overview';
import { resolveTarget } from '../monitoring/target';
import { recordFamilySnapshot } from '../store/health';
import { applyTransitions, listLiveProblems, listRecentlyResolved } from '../store/problems';
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

/** A family is as bad as its worst insight; with none, and having been read, it is healthy. */
function severityOf(insights: readonly { severity: string }[]): 'critical' | 'degraded' | null {
  if (insights.some((insight) => insight.severity === 'critical')) return 'critical';
  return insights.length > 0 ? 'degraded' : null;
}

export type DetectJobInput = {
  db: Db;
  connectionId: string;
  scope: string;
  nowMs: number;
};

export async function runDetectJob(input: DetectJobInput): Promise<JobOutcome> {
  const target = await resolveTarget({ connectionId: input.connectionId, region: input.scope });
  if (!target.ok) {
    // Nothing could be read, so nothing is claimed. Every live problem stays exactly as it was, and the
    // failure is what the run records — not a cycle in which everything quietly looked healthy.
    throw new Error('connection_unavailable');
  }

  const families = await Promise.all(
    INSIGHT_FAMILIES.map(async (family) => ({ family, result: await loadFamily(family, target.data, input.nowMs) })),
  );
  const read = new Set(families.filter(({ result }) => result.ok).map(({ family }) => family));
  const insights = families.flatMap(({ result }) => (result.ok ? result.data.insights : []));

  // What each family looked like, written down so Health can answer instantly and without AWS. A family that
  // could not be read says so, rather than being recorded as healthy — §2's rule that the two never look alike.
  for (const { family, result } of families) {
    const worst = result.ok ? severityOf(result.data.insights) : null;
    recordFamilySnapshot(input.db, {
      connectionId: input.connectionId,
      scope: input.scope,
      family,
      status: result.ok ? (worst ?? 'healthy') : 'unknown',
      total: result.ok ? result.data.total : null,
      affected: result.ok ? result.data.affected : null,
      readAt: input.nowMs,
      unavailableReason: result.ok ? null : result.reason,
      unavailableCode: result.ok ? null : (result.code ?? null),
    });
  }

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

  applyTransitions(input.db, { connectionId: input.connectionId, scope: input.scope }, transitions);

  // §16, on the rows this cycle just wrote. Evaluating it as a job of its own five minutes later would open
  // incidents for trouble that had already passed.
  runIncidentCycle(
    input.db,
    { connectionId: input.connectionId, scope: input.scope },
    listLiveProblems(input.db, input.connectionId, input.scope).map(({ row }) => row),
    input.nowMs,
  );

  return {
    // How much of the environment this cycle actually saw. A family that failed to load means it saw less
    // than all of it, which System status shows rather than hides.
    covered: read.size,
    total: INSIGHT_FAMILIES.length,
    truncated: read.size < INSIGHT_FAMILIES.length,
  };
}
