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
};

export type DoAlertsResult = { ok: true; policies: DoAlertPolicy[]; truncated: boolean } | { ok: false; reason: DoTestFailure };

/**
 * **Every** droplet alert policy needs `do-agent` on the droplets it watches.
 *
 * Not the metric-by-metric split the droplets page uses. DigitalOcean's own words about creating a
 * policy are: *"Only Droplets with the DigitalOcean metrics agent installed are available to
 * select."* All twelve metrics, bandwidth included — whatever the hypervisor can see for a graph, an
 * alert policy is offered only for droplets running the agent.
 *
 * So the caveat belongs to the page once, not to each row: a badge on every line is noise, and an
 * operator reading "Enabled" needs to know it means *enabled for the droplets that have the agent*.
 * An earlier version of this file guessed the split per metric, which was the wrong shape as well as
 * the wrong answer.
 */
export const DO_ALERTS_NEED_AGENT = true;

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
      });
    }
    if (batch.length < PER_PAGE) break;
    if (page === MAX_PAGES) truncated = true;
  }

  // Enabled first, then by name: the ones that can actually fire are the ones worth reading.
  policies.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.description.localeCompare(b.description));
  return { ok: true, policies, truncated };
}
