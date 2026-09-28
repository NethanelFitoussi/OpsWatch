import 'server-only';
import { accessTokenFor } from './federation';
import type { GcpTarget } from './target';

/**
 * What Google Cloud is currently complaining about in one project, and what it was asked to watch.
 *
 * **Both, because one without the other is not an answer.** An open incident says what is wrong. The
 * number of alerting policies says whether anything was ever set up to notice — and a project with no
 * open incidents and no policies is not a healthy project, it is a project nobody is watching. Showing
 * "0 incidents" for both would be manufacturing a health conclusion Google never made, which is
 * precisely what a monitoring tool must not do.
 *
 * Nothing here is a verdict of OpsWatch's own. Every word on the page is Google's: its policy names,
 * its severities, its open times. OpsWatch counts and arranges them.
 *
 * Verified against the current reference rather than from memory:
 *
 *   - `GET /v3/{name}/alerts` lists incidents — there is no `projects.incidents`; `alerts` is it.
 *     `orderBy` takes `openTime` or `closeTime`, `pageSize` defaults to 50 and caps at 1000
 *   - an `Alert` carries `name`, `state` (`OPEN` | `CLOSED` | `STATE_UNSPECIFIED`), `openTime`,
 *     `closeTime`, `resource`, `metric` and `policy` — a snapshot with `displayName` and `severity`
 *   - `GET /v3/{name}/alertPolicies` lists policies, each with `displayName` and `enabled`
 *   - both need `monitoring.read`, inside what `roles/monitoring.viewer` grants — the role this
 *     connection already asks for and tests
 */

const API = 'https://monitoring.googleapis.com/v3';
/** Enough to say "what is wrong" without walking an incident history in a page render. */
const INCIDENT_PAGE_SIZE = 50;
const POLICY_PAGE_SIZE = 200;
const MAX_PAGES = 4;

export type GcpIncident = {
  id: string;
  /** Google's own policy name. Never rewritten: it is what their console and their email say. */
  policy: string;
  /** Google's severity where it set one, null where it did not. Never defaulted to a level. */
  severity: string | null;
  openedAt: number | null;
  /** The monitored resource, as `type` plus whichever label names the thing. */
  resourceType: string | null;
  resourceName: string | null;
};

export type GcpPolicies = {
  total: number;
  enabled: number;
  /** True when there are more policies than were counted, so `total` is a floor rather than a figure. */
  truncated: boolean;
};

export type GcpAlertsFailure = 'denied' | 'unreachable' | 'no_token' | 'error';
export type GcpAlertsResult =
  | { ok: true; incidents: GcpIncident[]; policies: GcpPolicies; truncated: boolean }
  | { ok: false; reason: GcpAlertsFailure; detail?: string };

type RawAlert = {
  name?: string;
  state?: string;
  openTime?: string;
  resource?: { type?: string; labels?: Record<string, string> };
  policy?: { displayName?: string; severity?: string };
};
type RawPolicy = { displayName?: string; enabled?: boolean | { value?: boolean } };

/** Whichever label names the thing, in the order Google's own resources tend to carry them. */
const RESOURCE_NAME_LABELS = ['instance_name', 'instance_id', 'pod_name', 'service_name', 'database_id', 'bucket_name', 'revision_name'];

const nameOf = (labels: Record<string, string> | undefined): string | null => {
  if (labels === undefined) return null;
  for (const label of RESOURCE_NAME_LABELS) {
    const value = labels[label];
    if (typeof value === 'string' && value !== '') return value;
  }
  return null;
};

/**
 * `enabled` arrives either as a bare boolean or as a wrapped `{ value }`, depending on how the policy
 * was written. Read as truthy, a `{ value: false }` would count a switched-off policy as watching.
 */
const isEnabled = (enabled: RawPolicy['enabled']): boolean =>
  typeof enabled === 'boolean' ? enabled : typeof enabled === 'object' && enabled !== null ? enabled.value === true : false;

export async function projectAlerts(input: {
  target: GcpTarget;
  nowMs: number;
  fetchImpl?: typeof fetch;
}): Promise<GcpAlertsResult> {
  const call = input.fetchImpl ?? fetch;
  const token = await accessTokenFor({
    connectionId: input.target.connectionId,
    target: input.target.federation,
    key: input.target.key,
    baseUrl: input.target.baseUrl,
    nowMs: input.nowMs,
    fetchImpl: call,
  });
  if (!token.ok) return { ok: false, reason: token.reason === 'unreachable' ? 'unreachable' : 'no_token', detail: token.detail };

  const headers = { authorization: `Bearer ${token.data.token}` };
  const project = `projects/${encodeURIComponent(input.target.projectId)}`;

  const get = async (url: URL): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; reason: GcpAlertsFailure }> => {
    let response: Response;
    try {
      response = await call(url.toString(), { headers });
    } catch {
      return { ok: false, reason: 'unreachable' };
    }
    if (!response.ok) {
      const denied = response.status === 401 || response.status === 403;
      return { ok: false, reason: denied ? 'denied' : 'error' };
    }
    return { ok: true, body: (await response.json()) as Record<string, unknown> };
  };

  // Open incidents, newest first, which is the order somebody looking for what broke wants them in.
  const incidents: GcpIncident[] = [];
  let incidentsTruncated = false;
  let pageToken: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(`${API}/${project}/alerts`);
    url.searchParams.set('pageSize', String(INCIDENT_PAGE_SIZE));
    url.searchParams.set('orderBy', 'openTime desc');
    if (pageToken !== null) url.searchParams.set('pageToken', pageToken);

    const answer = await get(url);
    if (!answer.ok) return { ok: false, reason: answer.reason };

    for (const alert of (answer.body.alerts as RawAlert[] | undefined) ?? []) {
      // Closed incidents are history, and this page is about now. A closed one shown among the open
      // ones would be an operator chasing something that already ended.
      if (alert.state !== 'OPEN') continue;
      const id = typeof alert.name === 'string' ? (alert.name.split('/').pop() ?? '') : '';
      if (id === '') continue;
      const opened = Date.parse(alert.openTime ?? '');
      incidents.push({
        id,
        // No fallback name invented: a policy Google did not name is shown as one it did not name.
        policy: alert.policy?.displayName ?? '',
        severity: typeof alert.policy?.severity === 'string' && alert.policy.severity !== '' ? alert.policy.severity : null,
        openedAt: Number.isNaN(opened) ? null : opened,
        resourceType: alert.resource?.type ?? null,
        resourceName: nameOf(alert.resource?.labels),
      });
    }

    const next = answer.body.nextPageToken;
    pageToken = typeof next === 'string' && next !== '' ? next : null;
    if (pageToken === null) break;
    if (page === MAX_PAGES - 1) incidentsTruncated = true;
  }

  // And what this project was asked to watch at all, without which "nothing is wrong" means nothing.
  let total = 0;
  let enabled = 0;
  let policiesTruncated = false;
  pageToken = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(`${API}/${project}/alertPolicies`);
    url.searchParams.set('pageSize', String(POLICY_PAGE_SIZE));
    if (pageToken !== null) url.searchParams.set('pageToken', pageToken);

    const answer = await get(url);
    if (!answer.ok) return { ok: false, reason: answer.reason };

    for (const policy of (answer.body.alertPolicies as RawPolicy[] | undefined) ?? []) {
      total += 1;
      if (isEnabled(policy.enabled)) enabled += 1;
    }

    const next = answer.body.nextPageToken;
    pageToken = typeof next === 'string' && next !== '' ? next : null;
    if (pageToken === null) break;
    if (page === MAX_PAGES - 1) policiesTruncated = true;
  }

  return {
    ok: true,
    incidents,
    policies: { total, enabled, truncated: policiesTruncated },
    truncated: incidentsTruncated,
  };
}

/**
 * Whether "no open incidents" is worth anything.
 *
 * Only when something is switched on to notice. A project with no enabled policies and no incidents
 * has not been found healthy — it has not been looked at, and §2's rule is that those two must never
 * be shown the same way.
 */
export const quietMeansSomething = (policies: GcpPolicies): boolean => policies.enabled > 0;
