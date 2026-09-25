import 'server-only';
import type { DoTestFailure } from './result';

/**
 * The droplets of one DigitalOcean account.
 *
 * **The next page is constructed, never followed.** DigitalOcean's responses carry `links.pages.next`
 * as a full URL, and taking a URL out of a response body and fetching it is a request this code can be
 * talked into making — by a compromised endpoint, by a proxy, by anything between. The page number is
 * ours, the host is a constant, and there is no way to redirect this at something else.
 *
 * Paged all the same, because an account with three hundred droplets shown as two hundred is worse
 * than an error: nothing about it looks wrong. Bounded, because a page render must not walk an account
 * without end.
 */

const API = 'https://api.digitalocean.com/v2';
/** The documented maximum, so an account of any normal size is one or two calls rather than twenty. */
const PER_PAGE = 200;
const MAX_PAGES = 10;

export type Droplet = {
  id: number;
  name: string;
  /** DigitalOcean's own word: `active`, `off`, `new`, `archive`. */
  status: string;
  region: string | null;
  size: string | null;
  memoryMb: number | null;
  vcpus: number | null;
  createdAt: number | null;
};

export type DropletsResult = { ok: true; data: Droplet[] } | { ok: false; reason: DoTestFailure };

type RawDroplet = {
  id?: number;
  name?: string;
  status?: string;
  memory?: number;
  vcpus?: number;
  created_at?: string;
  region?: { slug?: string };
  size_slug?: string;
};

/** Which failure this is, in terms an operator can act on rather than a status code. */
function failureOf(status: number): DoTestFailure {
  if (status === 401) return 'unauthorized';
  // A token without `droplet:read` authenticates and is refused, which is a different thing to fix.
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  return 'error';
}

export async function listDroplets(input: { token: string | null; fetchImpl?: typeof fetch }): Promise<DropletsResult> {
  if (input.token === null || input.token === '') return { ok: false, reason: 'no_token' };
  const call = input.fetchImpl ?? fetch;
  const found: Droplet[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    let response: Response;
    try {
      response = await call(`${API}/droplets?page=${page}&per_page=${PER_PAGE}`, {
        headers: { authorization: `Bearer ${input.token}`, accept: 'application/json' },
      });
    } catch {
      return { ok: false, reason: 'unreachable' };
    }
    if (!response.ok) return { ok: false, reason: failureOf(response.status) };

    const body = (await response.json()) as { droplets?: RawDroplet[] };
    const batch = body.droplets ?? [];
    for (const droplet of batch) {
      if (typeof droplet.id !== 'number' || typeof droplet.name !== 'string') continue;
      const created = droplet.created_at === undefined ? Number.NaN : Date.parse(droplet.created_at);
      found.push({
        id: droplet.id,
        name: droplet.name,
        status: droplet.status ?? 'unknown',
        region: droplet.region?.slug ?? null,
        size: droplet.size_slug ?? null,
        // A figure DigitalOcean did not send is unknown, never zero.
        memoryMb: typeof droplet.memory === 'number' ? droplet.memory : null,
        vcpus: typeof droplet.vcpus === 'number' ? droplet.vcpus : null,
        createdAt: Number.isNaN(created) ? null : created,
      });
    }
    // A short page is the last page. Asked rather than read off a link, for the reason above.
    if (batch.length < PER_PAGE) break;
  }

  // Newest first: the droplet somebody just made is the one they are looking for.
  return { ok: true, data: found.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)) };
}
