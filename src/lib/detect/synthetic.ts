/**
 * The rules a synthetic check is judged by (§14).
 *
 * Pure: run outcomes in, a verdict out. Nothing here opens a socket — the running is `lib/synthetics/run.ts`,
 * which goes through `safeFetch` so that a URL a user typed cannot be aimed at the metadata service.
 *
 * The shape of every rule here is "one observation is not a fact". A single failed request is a blip, a
 * single slow one is a neighbour's backup job, and a monitoring tool that pages on either is one people
 * turn off.
 */

/** §14: down after two consecutive failures, up after one success. */
export const FAILURES_TO_DOWN = 2;
/** §14: the median of the last five runs decides whether a check is slow. */
export const LATENCY_SAMPLE = 5;
/** §14's certificate thresholds, in days. */
export const CERT_WARNING_DAYS = 21;
export const CERT_CRITICAL_DAYS = 7;

export type SyntheticStatus = 'up' | 'down' | 'unknown';

export type RunOutcome = {
  at: number;
  ok: boolean;
  /** Total time in milliseconds, or null when the run never got far enough to measure one. */
  totalMs: number | null;
};

/**
 * The status after a run, from the run history.
 *
 * `unknown` until there is anything to judge — a check that has never run is not up, and showing it as up
 * would be the most consequential lie this feature could tell.
 */
export function statusFrom(runs: readonly RunOutcome[]): SyntheticStatus {
  if (runs.length === 0) return 'unknown';
  const newestFirst = [...runs].sort((a, b) => b.at - a.at);

  // One success is enough to be up: recovering should be immediate, because a stale `down` is what makes
  // people stop believing the board.
  if (newestFirst[0].ok) return 'up';

  let consecutiveFailures = 0;
  for (const run of newestFirst) {
    if (run.ok) break;
    consecutiveFailures += 1;
  }
  // One failure is a blip. Two in a row is an outage.
  return consecutiveFailures >= FAILURES_TO_DOWN ? 'down' : 'up';
}

/** The median total time of the last few runs, or null when none of them measured one. */
export function medianLatency(runs: readonly RunOutcome[], sample = LATENCY_SAMPLE): number | null {
  const times = [...runs]
    .sort((a, b) => b.at - a.at)
    .slice(0, sample)
    .map((run) => run.totalMs)
    .filter((total): total is number => total !== null)
    .sort((a, b) => a - b);
  if (times.length === 0) return null;
  const middle = Math.floor(times.length / 2);
  // An even sample takes the mean of the two middle values, so one outlier cannot become "the median".
  return times.length % 2 === 1 ? times[middle] : (times[middle - 1] + times[middle]) / 2;
}

/** Whether the check is slow enough to be a problem, per §14. Null threshold means nobody set one. */
export function isSlow(runs: readonly RunOutcome[], thresholdMs: number | null): boolean {
  if (thresholdMs === null) return false;
  const median = medianLatency(runs);
  return median !== null && median > thresholdMs;
}

export type CertificateSeverity = 'critical' | 'warning' | null;

/**
 * How urgent a certificate's expiry is (§14).
 *
 * Null when there is no expiry to judge — a check against a plain-HTTP endpoint has no certificate, and
 * reporting that as healthy would be as wrong as reporting it as expiring.
 */
export function certificateSeverity(expiresAt: number | null, nowMs: number): CertificateSeverity {
  if (expiresAt === null) return null;
  const days = (expiresAt - nowMs) / (24 * 60 * 60_000);
  if (days <= CERT_CRITICAL_DAYS) return 'critical';
  return days <= CERT_WARNING_DAYS ? 'warning' : null;
}

export type Assertion =
  | { kind: 'status_in'; values: number[] }
  | { kind: 'status_range'; from: number; to: number }
  | { kind: 'body_contains'; value: string }
  | { kind: 'body_excludes'; value: string }
  | { kind: 'body_matches'; value: string };

export type AssertionResult = { assertion: Assertion; ok: boolean; reason: 'passed' | 'failed' | 'not_evaluated' };

/** §14: a pattern is capped, so a check nobody reviews cannot become a way to hang the collector. */
export const MAX_PATTERN_LENGTH = 200;
/** §14: at most the first 256 KB of a body is considered. */
export const MAX_BODY_BYTES = 256 * 1024;

/**
 * Evaluates one assertion.
 *
 * A body assertion on a response with no body is `not_evaluated` rather than failed: §2.6's distinction
 * again — an assertion nobody could check is not an assertion that failed, and treating it as failure would
 * page somebody for a missing measurement.
 */
export function evaluateAssertion(assertion: Assertion, response: { status: number | null; body: string | null }): AssertionResult {
  const notEvaluated: AssertionResult = { assertion, ok: false, reason: 'not_evaluated' };

  if (assertion.kind === 'status_in' || assertion.kind === 'status_range') {
    if (response.status === null) return notEvaluated;
    const ok =
      assertion.kind === 'status_in'
        ? assertion.values.includes(response.status)
        : response.status >= assertion.from && response.status <= assertion.to;
    return { assertion, ok, reason: ok ? 'passed' : 'failed' };
  }

  if (response.body === null) return notEvaluated;
  const body = response.body.slice(0, MAX_BODY_BYTES);

  if (assertion.kind === 'body_contains') {
    const ok = body.includes(assertion.value);
    return { assertion, ok, reason: ok ? 'passed' : 'failed' };
  }
  if (assertion.kind === 'body_excludes') {
    const ok = !body.includes(assertion.value);
    return { assertion, ok, reason: ok ? 'passed' : 'failed' };
  }

  // A pattern an operator typed. Over-long ones are refused rather than run, and a pattern that does not
  // compile leaves the assertion unevaluated instead of taking the check down.
  if (assertion.value.length > MAX_PATTERN_LENGTH) return notEvaluated;
  try {
    const ok = new RegExp(assertion.value).test(body);
    return { assertion, ok, reason: ok ? 'passed' : 'failed' };
  } catch {
    return notEvaluated;
  }
}

/**
 * Whether a run passed: every assertion that could be evaluated passed, and at least one was.
 *
 * A run where nothing could be evaluated is not a pass. It is a run that measured nothing, and the caller
 * records it as a failure with that reason rather than as a success.
 */
export function runPassed(results: readonly AssertionResult[]): boolean {
  const evaluated = results.filter((result) => result.reason !== 'not_evaluated');
  return evaluated.length > 0 && evaluated.every((result) => result.ok);
}
