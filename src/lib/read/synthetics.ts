import 'server-only';
import type { SyntheticSummary } from '@opswatch/contract';
import type { Db } from '../db/client';
import type { SyntheticRunRow } from '../db/schema';
import { medianLatency, statusFrom } from '../detect/synthetic';
import { listChecks, recentRuns, runsBetween, toOutcome } from '../store/synthetics';

/**
 * What OpsWatch's own checks saw, as every client reads it (§14, SYN-1).
 *
 * Three states, never two. A check that has never run is `unknown` with no figures — not `up`, which would
 * be the tool reporting health it has not measured, and not `down`, which would be an outage it invented.
 * Every ratio here is `null` until there is at least one run to compute it from (§2.4).
 */

/** How many runs the status rule looks back over. §14 needs the last few, not the last month. */
const STATUS_SAMPLE = 10;

const DAY_MS = 24 * 60 * 60_000;
const MONTH_MS = 30 * DAY_MS;

/** The share of runs that passed, or null when none ran — which is not zero and not one. */
export function successShare(runs: readonly { ok: boolean }[]): number | null {
  if (runs.length === 0) return null;
  return runs.filter((run) => run.ok).length / runs.length;
}

/**
 * What the newest run knows about the certificate.
 *
 * `null` when nothing has run or the check is plain HTTP: a check with no certificate is not a check with a
 * healthy one. `valid` is decided against the clock rather than stored, because an expiry stored yesterday
 * is still the truth and "valid" is not.
 */
export function sslOf(newest: SyntheticRunRow | undefined, nowMs: number): SyntheticSummary['ssl'] {
  if (newest === undefined || newest.certificateExpiresAt === null) return null;
  return { valid: newest.certificateExpiresAt > nowMs, expiresAt: newest.certificateExpiresAt };
}

export function listSyntheticSummaries(db: Db, query: { connectionId: string; scope: string }, nowMs: number): SyntheticSummary[] {
  return listChecks(db, query.connectionId, query.scope).map((check) => {
    const recent = recentRuns(db, check.id, STATUS_SAMPLE);
    const outcomes = recent.map(toOutcome);
    return {
      id: check.id,
      name: check.name,
      // One kind today. It is a string in the contract so a TCP or DNS check does not need a new field.
      kind: 'http',
      target: check.url,
      status: statusFrom(outcomes),
      availability24h: successShare(runsBetween(db, check.id, nowMs - DAY_MS, nowMs)),
      uptime30d: successShare(runsBetween(db, check.id, nowMs - MONTH_MS, nowMs)),
      latencyMs: medianLatency(outcomes),
      ssl: sslOf(recent[0], nowMs),
      lastCheckedAt: recent[0]?.at ?? null,
    };
  });
}
