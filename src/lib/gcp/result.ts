import type { FederationFailure } from './federation-types';

/**
 * What a Google connection's last test found.
 *
 * Its own type, in its own file, because `schema.ts` must not reach into a `server-only` module to
 * describe the shape of a JSON column — the column is data, and the code that fills it is not.
 */

export const GCP_CHECKS = ['compute', 'monitoring'] as const;
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
