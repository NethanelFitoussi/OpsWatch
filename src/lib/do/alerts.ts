import 'server-only';
import type { DoTestFailure } from './result';
import type { DoTarget } from './target';

/**
 * What an operator asked DigitalOcean to tell them about.
 *
 * **Policies only, because policies are all DigitalOcean exposes.** Its Monitoring API has the five
 * CRUD operations on alert policies and sixty metric endpoints, and **no endpoint at all that returns
 * which policies are currently firing.** Google has `projects.alerts`, so OpsWatch can show a Google
 * project's open incidents; DigitalOcean has no equivalent, so it cannot — and the page says so in
 * those words rather than leaving an empty list that reads as "nothing is wrong".
 *
 * That asymmetry is the point rather than a gap to paper over. Three clouds, three different answers
 * to "what does the provider itself say is wrong": CloudWatch alarms with their state, Google
 * incidents with their severity, and DigitalOcean's configuration with no state behind it.
 *
 * Verified against the current reference: `GET /v2/monitoring/alerts` answers `{ policies: [...] }`,
 * each with `uuid`, `type` (`v1/insights/droplet/cpu` and the like), `description`, `compare`
 * (`GreaterThan` | `LessThan`), `value`, `window` (`5m` | `10m` | `30m` | `1h`), `entities`, `tags`
 * and `enabled`. It needs the same read token the droplet list does.
 */

const API = 'https://api.digitalocean.com/v2';
const PER_PAGE = 200;
const MAX_PAGES = 5;

export type DoAlertPolicy = {
  uuid: string;
  /** DigitalOcean's own type string, left in its vocabulary. */
  type: string;
  description: string;
  compare: string | null;
  value: number | null;
  window: string | null;
  /** How many droplets it watches, and how many tags. Both, because a policy may use either. */
  entities: number;
  tags: number;
  enabled: boolean;
  /**
   * Whether the figure this policy watches needs `do-agent` inside the droplet.
   *
   * A CPU or memory policy on a droplet without the agent never fires, and a list that showed it as
   * enabled would be telling an operator they are covered when they are not.
   */
  needsAgent: boolean;
};

export type DoAlertsResult = { ok: true; policies: DoAlertPolicy[]; truncated: boolean } | { ok: false; reason: DoTestFailure };

/**
 * Which policy types watch a figure `do-agent` reports.
 *
 * From the same split the droplets page states: DigitalOcean measures bandwidth, disk I/O and disk
 * usage from outside the droplet, and CPU, load average and memory from inside it.
 */
const AGENT_METRICS = ['cpu', 'memory', 'load_1', 'load_5', 'load_15', 'disk_utilization_percent'];

export const needsAgentFor = (type: string): boolean => {
  // `v1/insights/droplet/cpu` → `cpu`. Anything that is not a droplet insight is not ours to judge.
  const metric = type.split('/').pop() ?? '';
  return AGENT_METRICS.includes(metric);
};

function failureOf(status: number): DoTestFailure {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  return 'error';
}

type RawPolicy = {
  uuid?: string;
  type?: string;
  description?: string;
  compare?: string;
  value?: number;
  window?: string;
  entities?: unknown[];
  tags?: unknown[];
  enabled?: boolean;
};

export async function listAlertPolicies(input: { target: DoTarget; fetchImpl?: typeof fetch }): Promise<DoAlertsResult> {
  const call = input.fetchImpl ?? fetch;
  const policies: DoAlertPolicy[] = [];
  let truncated = false;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    let response: Response;
    try {
      // The page number is ours and the host is a constant, as everywhere else that talks to this
      // API: a `links.pages.next` taken out of a response body is a request this code can be talked
      // into making.
      response = await call(`${API}/monitoring/alerts?page=${page}&per_page=${PER_PAGE}`, {
        headers: { authorization: `Bearer ${input.target.token}`, accept: 'application/json' },
      });
    } catch {
      return { ok: false, reason: 'unreachable' };
    }
    if (!response.ok) return { ok: false, reason: failureOf(response.status) };

    const body = (await response.json()) as { policies?: RawPolicy[] };
    const batch = body.policies ?? [];
    for (const policy of batch) {
      if (typeof policy.uuid !== 'string' || typeof policy.type !== 'string') continue;
      policies.push({
        uuid: policy.uuid,
        type: policy.type,
        description: policy.description ?? '',
        // A comparison or threshold DigitalOcean did not send is unknown, never zero: `value: 0` on a
        // CPU policy reads as "alert above 0 %", which is a different policy entirely.
        compare: policy.compare ?? null,
        value: typeof policy.value === 'number' ? policy.value : null,
        window: policy.window ?? null,
        entities: Array.isArray(policy.entities) ? policy.entities.length : 0,
        tags: Array.isArray(policy.tags) ? policy.tags.length : 0,
        // Absent means off. Read as truthy, `undefined` would count a policy as watching.
        enabled: policy.enabled === true,
        needsAgent: needsAgentFor(policy.type),
      });
    }
    if (batch.length < PER_PAGE) break;
    if (page === MAX_PAGES) truncated = true;
  }

  // Enabled first, then by name: the ones that can actually fire are the ones worth reading.
  policies.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.description.localeCompare(b.description));
  return { ok: true, policies, truncated };
}
