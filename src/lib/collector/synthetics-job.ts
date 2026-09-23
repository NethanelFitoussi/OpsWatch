import 'server-only';
import { decrypt } from '../crypto';
import type { Db } from '../db/client';
import { type Assertion } from '../detect/synthetic';
import { syntheticOutcomes } from '../detect/synthetic-detectors';
import { applyCycle } from '../detect/lifecycle';
import { applyTransitions, listLiveProblems, listRecentlyResolved } from '../store/problems';
import { RESOLVED_RETENTION_MS } from '../store/retention';
import { enabledChecks, recentRuns, recordRun, secretHeadersFor, toOutcome } from '../store/synthetics';
import { runCheck } from '../synthetics/run';
import type { JobOutcome } from './runner';

/**
 * The `synthetics` job: run each enabled check, once per cycle (§14).
 *
 * Checks are **off until enabled**, like every other thing in this product that costs something — here the
 * cost is outbound requests from the operator's own host to a third party, which is not free and is not
 * always welcome.
 *
 * A check that throws does not take the cycle down. One unreachable endpoint must not stop the others from
 * being measured, which is the same isolation §33.5 requires of detectors.
 */

/** How many past runs the rules need: §14's status uses two, its latency uses five. */
const HISTORY = 10;

export type SyntheticsJobInput = { db: Db; connectionId: string; scope: string; nowMs: number; secret: string };

export async function runSyntheticsJob(input: SyntheticsJobInput): Promise<JobOutcome> {
  const checks = enabledChecks(input.db, input.connectionId, input.scope);
  if (checks.length === 0) return { covered: 0, total: 0 };

  let ran = 0;
  for (const check of checks) {
    try {
      // Decrypted here and nowhere else, held only for the length of one request, never stored or logged.
      const ciphertext = check.hasSecretHeaders ? secretHeadersFor(input.db, check.id) : null;
      const headers =
        ciphertext === null ? undefined : (JSON.parse(decrypt(ciphertext, input.secret, 'access-keys')) as Record<string, string>);

      const result = await runCheck(
        { url: check.url, method: check.method, assertions: check.assertions as Assertion[], ...(headers === undefined ? {} : { headers }) },
        {},
      );

      recordRun(input.db, {
        checkId: check.id,
        at: input.nowMs,
        ok: result.ok,
        status: result.status,
        totalMs: result.totalMs,
        bodyBytes: result.bodyBytes,
        failureReason: result.failureReason,
        assertionResults: result.assertionResults,
      });
      ran += 1;
    } catch {
      // Recorded as a failure with a reason rather than dropped: a check that could not be run is a fact,
      // and a silent gap in the history would read as a period when nothing was wrong.
      recordRun(input.db, {
        checkId: check.id,
        at: input.nowMs,
        ok: false,
        totalMs: null,
        failureReason: 'run_failed',
        assertionResults: [],
      });
      ran += 1;
    }
  }

  // The outcomes go through the same lifecycle as every other detector, so a failing check opens, reopens,
  // flaps and resolves exactly like a failing service. A synthetic failure is not a second kind of alert
  // living beside problems — it is a problem.
  const outcomes = enabledChecks(input.db, input.connectionId, input.scope).flatMap((check) => {
    const runs = recentRuns(input.db, check.id, HISTORY);
    return syntheticOutcomes(
      {
        id: check.id,
        name: check.name,
        url: check.url,
        latencyThresholdMs: check.latencyThresholdMs,
        runs: runs.map(toOutcome),
        certificateExpiresAt: runs.find((run) => run.certificateExpiresAt !== null)?.certificateExpiresAt ?? null,
      },
      input.nowMs,
    );
  });

  const live = listLiveProblems(input.db, input.connectionId, input.scope);
  const transitions = applyCycle({
    connectionId: input.connectionId,
    scope: input.scope,
    // Only the synthetic problems: this cycle has nothing to say about an ECS service, and handing the
    // lifecycle problems it did not evaluate would resolve them on silence.
    live: live.filter(({ row }) => row.subjectType === 'synthetic').map(({ live: projection }) => projection),
    // Everything still retained, as the detect cycle does: the lifecycle applies the reopen window itself
    // and needs the older rows so a successor can carry `previousProblemId`.
    resolvedInWindow: listRecentlyResolved(input.db, input.connectionId, input.scope, input.nowMs - RESOLVED_RETENTION_MS),
    cycle: { at: input.nowMs, outcomes, failed: [] },
    nowMs: input.nowMs,
  });
  applyTransitions(input.db, { connectionId: input.connectionId, scope: input.scope }, transitions);

  return { covered: ran, total: checks.length, truncated: ran < checks.length };
}

