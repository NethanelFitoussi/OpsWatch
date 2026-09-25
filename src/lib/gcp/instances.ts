import 'server-only';
import { accessTokenFor, type FederationTarget } from './federation';
import type { ConnectionKey } from './issuer';

/**
 * The instances in one region of a Google Cloud project.
 *
 * `aggregatedList` answers for the whole project, keyed by zone — `zones/us-central1-a` — so the region
 * is applied here by matching the zone prefix rather than by a `filter` expression. Google's filter
 * syntax is its own language, and a query written in it from memory that silently matches nothing is
 * indistinguishable from a project with no instances. Prefix matching is checkable by reading it.
 *
 * Every figure is what Google reported. A field it did not send is `null`, never a zero: an instance
 * whose machine type was not in the answer is not an instance with no machine type.
 */

export type GcpInstance = {
  id: string;
  name: string;
  zone: string;
  /** `RUNNING`, `TERMINATED`, and the rest of Google's own vocabulary, left in it. */
  status: string;
  machineType: string | null;
  createdAt: number | null;
};

export type GcpInstancesFailure = 'denied' | 'unreachable' | 'no_token' | 'error';
export type GcpInstancesResult = { ok: true; data: GcpInstance[] } | { ok: false; reason: GcpInstancesFailure; detail?: string };

/** The last segment of a Google resource URL, which is how it names a machine type or a zone. */
const lastSegment = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? (value.split('/').pop() ?? null) : null;

type RawInstance = { id?: string; name?: string; status?: string; machineType?: string; creationTimestamp?: string; zone?: string };
type Aggregated = { items?: Record<string, { instances?: RawInstance[]; warning?: { code?: string } }> };

/**
 * Instances in `region`, as Google answered.
 *
 * Paged: `aggregatedList` returns a page token, and stopping at the first page would quietly show part
 * of a project as though it were all of it. Bounded all the same — a project with tens of thousands of
 * instances is not something to walk in a page render.
 */
export async function instancesInRegion(input: {
  connectionId: string;
  projectId: string;
  region: string;
  target: FederationTarget;
  key: ConnectionKey | null;
  baseUrl: string | undefined;
  nowMs: number;
  maxPages?: number;
  fetchImpl?: typeof fetch;
}): Promise<GcpInstancesResult> {
  if (input.key === null) return { ok: false, reason: 'no_token' };
  const call = input.fetchImpl ?? fetch;

  const token = await accessTokenFor({
    connectionId: input.connectionId,
    target: input.target,
    key: input.key,
    baseUrl: input.baseUrl,
    nowMs: input.nowMs,
    fetchImpl: call,
  });
  if (!token.ok) return { ok: false, reason: token.reason === 'unreachable' ? 'unreachable' : 'no_token', detail: token.detail };

  const found: GcpInstance[] = [];
  let pageToken: string | null = null;
  const maxPages = input.maxPages ?? 10;

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(`https://compute.googleapis.com/compute/v1/projects/${encodeURIComponent(input.projectId)}/aggregated/instances`);
    url.searchParams.set('maxResults', '500');
    if (pageToken !== null) url.searchParams.set('pageToken', pageToken);

    let response: Response;
    try {
      response = await call(url.toString(), { headers: { authorization: `Bearer ${token.data.token}` } });
    } catch {
      return { ok: false, reason: 'unreachable' };
    }
    if (!response.ok) {
      const denied = response.status === 401 || response.status === 403;
      return { ok: false, reason: denied ? 'denied' : 'error' };
    }

    const body = (await response.json()) as Aggregated & { nextPageToken?: string };
    for (const [scope, entry] of Object.entries(body.items ?? {})) {
      // `zones/us-central1-a` belongs to `us-central1`; `global` and other scopes belong to no region.
      const zone = scope.startsWith('zones/') ? scope.slice('zones/'.length) : null;
      if (zone === null || !zone.startsWith(`${input.region}-`)) continue;

      for (const instance of entry.instances ?? []) {
        if (typeof instance.id !== 'string' || typeof instance.name !== 'string') continue;
        const created = instance.creationTimestamp === undefined ? Number.NaN : Date.parse(instance.creationTimestamp);
        found.push({
          id: instance.id,
          name: instance.name,
          zone,
          // Google's own word, not a translation of it: "TERMINATED" is what their console says too.
          status: instance.status ?? 'UNKNOWN',
          machineType: lastSegment(instance.machineType),
          createdAt: Number.isNaN(created) ? null : created,
        });
      }
    }

    pageToken = typeof body.nextPageToken === 'string' && body.nextPageToken !== '' ? body.nextPageToken : null;
    if (pageToken === null) break;
  }

  // Newest first: the instance somebody just created is the one they are looking for.
  return { ok: true, data: found.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)) };
}
