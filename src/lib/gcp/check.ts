import 'server-only';
import { CLOUD_PLATFORM_SCOPE, accessTokenFor, type FederationTarget } from './federation';
import { GCP_CHECKS, type GcpCheck, type GcpCheckName, type GcpTestResult } from './result';

export { GCP_CHECKS, type GcpCheck, type GcpCheckName, type GcpTestResult };
import type { ConnectionKey } from './issuer';

/**
 * What this connection can actually read, asked of Google rather than assumed.
 *
 * The same principle as the AWS permission test: a connection that authenticated is not a connection
 * that can read anything, and an operator who granted one role and forgot the other needs to be told
 * which one. So each read is attempted separately and reported separately, and "denied" is a different
 * answer from "the exchange never worked".
 *
 * Two reads, because two roles are asked for and no more:
 *
 *   - `roles/compute.viewer`, for the instances — `compute.instances.list`.
 *   - `roles/monitoring.viewer`, for the figures — its `monitoring.metricDescriptors.list`, which is
 *     the cheapest call that fails in exactly the case `monitoring.timeSeries.list` would.
 *
 * `maxResults`/`pageSize` of 1 throughout: this asks whether the door opens, not what is behind it.
 */

export const GCP_ROLES = ['roles/compute.viewer', 'roles/monitoring.viewer'] as const;

const ENDPOINT: Record<GcpCheckName, (projectId: string) => string> = {
  compute: (id) => `https://compute.googleapis.com/compute/v1/projects/${encodeURIComponent(id)}/aggregated/instances?maxResults=1`,
  monitoring: (id) => `https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(id)}/metricDescriptors?pageSize=1`,
};

async function readDetail(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return typeof body.error?.message === 'string' ? body.error.message.slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}

async function runCheck(name: GcpCheckName, projectId: string, token: string, call: typeof fetch): Promise<GcpCheck> {
  let response: Response;
  try {
    response = await call(ENDPOINT[name](projectId), { headers: { authorization: `Bearer ${token}` } });
  } catch {
    return { check: name, status: 'error' };
  }
  if (response.ok) return { check: name, status: 'ok' };
  // A missing role and a broken API are different things to tell somebody, and only one is their doing.
  const status = response.status === 403 || response.status === 401 ? 'denied' : 'error';
  return { check: name, status, detail: await readDetail(response) };
}

export async function testGoogleConnection(input: {
  connectionId: string;
  projectId: string;
  target: FederationTarget;
  key: ConnectionKey | null;
  baseUrl: string | undefined;
  nowMs: number;
  fetchImpl?: typeof fetch;
}): Promise<GcpTestResult> {
  const call = input.fetchImpl ?? fetch;
  if (input.key === null) return { testedAt: input.nowMs, federation: 'no_key', checks: [] };

  const token = await accessTokenFor({
    connectionId: input.connectionId,
    target: input.target,
    key: input.key,
    baseUrl: input.baseUrl,
    nowMs: input.nowMs,
    fetchImpl: call,
  });
  // No token means the checks were not run, which is not the same as their having failed. An empty
  // list of checks beside a stated reason says that; a list of failures would blame the wrong thing.
  if (!token.ok) return { testedAt: input.nowMs, federation: token.reason, detail: token.detail, checks: [] };

  const checks = await Promise.all(GCP_CHECKS.map((name) => runCheck(name, input.projectId, token.data.token, call)));
  return { testedAt: input.nowMs, federation: null, checks };
}

/** The scope every one of these reads is made with, stated once so a page can show it. */
export const GCP_SCOPE = CLOUD_PLATFORM_SCOPE;
