import type { FederationFailure } from './federation-types';

/**
 * What a Google connection's last test found.
 *
 * Its own type, in its own file, because `schema.ts` must not reach into a `server-only` module to
 * describe the shape of a JSON column — the column is data, and the code that fills it is not.
 */

/**
 * The three reads a connection is tested for, and `logging` is **optional**.
 *
 * The first two are what the wizard asks for and what every Google page needs. The third is a role an
 * operator grants separately and may decline: it reads log *content*, which is whatever somebody's
 * code wrote, where everything else OpsWatch reads from Google is a count or a status. Tested all the
 * same, because "you have not granted it" and "you granted it and it does not work" are different
 * answers — and a connection without it is complete rather than broken.
 */
export const GCP_CHECKS = ['compute', 'monitoring', 'logging'] as const;
/** The ones a connection must have to be usable at all. `logging` is not among them by design. */
export const GCP_REQUIRED_CHECKS = ['compute', 'monitoring'] as const;
export type GcpCheckName = (typeof GCP_CHECKS)[number];

export type GcpCheckStatus = 'ok' | 'denied' | 'error';
export type GcpCheck = { check: GcpCheckName; status: GcpCheckStatus; detail?: string };

export type GcpTestResult = {
  testedAt: number;
  /** Null when a token was obtained; otherwise why there was none, and the checks were not attempted. */
  federation: FederationFailure | null;
  detail?: string;
  checks: GcpCheck[];
};

/**
 * What this connection's last test makes it.
 *
 * **Judged on the required checks alone.** `logging` is a role an operator grants separately and may
 * decline for good reasons — it reads log content, where everything else reads counts and statuses —
 * so a connection without it is complete, not degraded. Counting it would mark a perfectly working
 * project as broken for declining something optional, and train an operator to ignore the colour.
 */
export function gcpStatusOf(checks: readonly GcpCheck[]): 'failed' | 'degraded' | 'ok' {
  const required = checks.filter((check) => (GCP_REQUIRED_CHECKS as readonly string[]).includes(check.check));
  const readable = required.filter((check) => check.status === 'ok').length;
  // Nothing required could be read: a connection that authenticated and can see nothing.
  if (readable === 0) return 'failed';
  return readable < required.length ? 'degraded' : 'ok';
}
