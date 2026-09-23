import 'server-only';
import { decrypt } from '../crypto';
import type { Db } from '../db/client';
import { statusFrom, type Assertion } from '../detect/synthetic';
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

  return { covered: ran, total: checks.length, truncated: ran < checks.length };
}

/** The current status of every enabled check, from its run history (§14). */
export function checkStatuses(db: Db, connectionId: string, scope: string): { id: string; name: string; status: ReturnType<typeof statusFrom> }[] {
  return enabledChecks(db, connectionId, scope).map((check) => ({
    id: check.id,
    name: check.name,
    status: statusFrom(recentRuns(db, check.id, HISTORY).map(toOutcome)),
  }));
}
