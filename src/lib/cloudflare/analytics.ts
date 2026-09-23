import 'server-only';
import { SsrfError, safeFetch } from '../net/safe-fetch';
import type { CloudflareFailure } from './api';

/**
 * What Cloudflare saw at the edge, one day at a time (CF-2, §20).
 *
 * Read through their GraphQL analytics API, which is what the `Zone → Analytics → Read` permission the
 * guide asks for actually buys. **Only fields that API returns** — no estimate, no derived figure dressed
 * as a measurement, and nothing a free zone cannot serve.
 *
 * The grain is a day because `httpRequests1dGroups` is what every plan reports. An hourly series exists on
 * higher plans and would produce a chart that is full for some operators and empty for others, which is
 * worse than one grain everybody gets.
 */

const ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';
const TIMEOUT_MS = 20_000;

/** How many days one read asks for. A fortnight is enough to see a weekly shape without paging. */
export const ANALYTICS_DAYS = 14;

export type ZoneDay = {
  date: string;
  requests: number;
  cachedRequests: number;
  bytes: number;
  cachedBytes: number;
  threats: number;
  uniques: number | null;
  clientErrors: number;
  serverErrors: number;
};

export type AnalyticsResult = { ok: true; days: ZoneDay[] } | { ok: false; error: CloudflareFailure };

export type AnalyticsDeps = { fetch?: typeof safeFetch; timeoutMs?: number };

/** `YYYY-MM-DD` in UTC, which is how Cloudflare groups a day. */
export function dayKey(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 10);
}

/**
 * The query, built rather than templated from caller input.
 *
 * The zone tag is the only variable and it goes through GraphQL variables, so a zone id cannot become
 * query syntax however it was obtained.
 */
export function analyticsQuery(): string {
  return `query ZoneDays($zone: String!, $since: String!) {
  viewer {
    zones(filter: { zoneTag: $zone }) {
      httpRequests1dGroups(limit: ${ANALYTICS_DAYS}, filter: { date_geq: $since }, orderBy: [date_ASC]) {
        dimensions { date }
        sum { requests bytes cachedRequests cachedBytes threats responseStatusMap { edgeResponseStatus requests } }
        uniq { uniques }
      }
    }
  }
}`;
}

const NUMBER = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** Splits the status map into the two ranges an operator acts on differently. */
export function errorsFrom(statusMap: unknown): { clientErrors: number; serverErrors: number } {
  if (!Array.isArray(statusMap)) return { clientErrors: 0, serverErrors: 0 };
  let clientErrors = 0;
  let serverErrors = 0;
  for (const entry of statusMap) {
    if (typeof entry !== 'object' || entry === null) continue;
    const status = NUMBER((entry as { edgeResponseStatus?: unknown }).edgeResponseStatus);
    const requests = NUMBER((entry as { requests?: unknown }).requests);
    // A 4xx is usually somebody else's mistake and a 5xx is usually yours. Summing them into one number
    // would hide the distinction that decides whether anybody needs to act.
    if (status >= 500) serverErrors += requests;
    else if (status >= 400) clientErrors += requests;
  }
  return { clientErrors, serverErrors };
}

export function parseDays(payload: unknown): ZoneDay[] | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const body = payload as { data?: { viewer?: { zones?: unknown } }; errors?: unknown };
  // GraphQL answers 200 with an `errors` array. Reading only the status would report a failure as data.
  if (Array.isArray(body.errors) && body.errors.length > 0) return null;
  const zones = body.data?.viewer?.zones;
  if (!Array.isArray(zones)) return null;
  const groups = (zones[0] as { httpRequests1dGroups?: unknown } | undefined)?.httpRequests1dGroups;
  // A zone with no traffic answers an empty list, which is data rather than a failure.
  if (!Array.isArray(groups)) return zones.length === 0 ? [] : null;

  return groups.flatMap((group): ZoneDay[] => {
    if (typeof group !== 'object' || group === null) return [];
    const row = group as { dimensions?: { date?: unknown }; sum?: Record<string, unknown>; uniq?: { uniques?: unknown } };
    const date = typeof row.dimensions?.date === 'string' ? row.dimensions.date : null;
    if (date === null) return [];
    const { clientErrors, serverErrors } = errorsFrom(row.sum?.responseStatusMap);
    return [
      {
        date,
        requests: NUMBER(row.sum?.requests),
        cachedRequests: NUMBER(row.sum?.cachedRequests),
        bytes: NUMBER(row.sum?.bytes),
        cachedBytes: NUMBER(row.sum?.cachedBytes),
        threats: NUMBER(row.sum?.threats),
        // Null rather than zero: a plan that does not report uniques has not measured none.
        uniques: typeof row.uniq?.uniques === 'number' ? row.uniq.uniques : null,
        clientErrors,
        serverErrors,
      },
    ];
  });
}

export async function fetchZoneDays(token: string, zoneId: string, sinceMs: number, deps: AnalyticsDeps = {}): Promise<AnalyticsResult> {
  const send = deps.fetch ?? safeFetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? TIMEOUT_MS);

  try {
    const response = await send(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: analyticsQuery(), variables: { zone: zoneId, since: dayKey(sinceMs) } }),
      signal: controller.signal,
    });
    if (response.status === 401) return { ok: false, error: 'unauthorized' };
    if (response.status === 403) return { ok: false, error: 'forbidden' };
    if (response.status === 429) return { ok: false, error: 'rate_limited' };
    if (!response.ok) return { ok: false, error: 'bad_response' };

    const days = parseDays(await response.json().catch(() => null));
    return days === null ? { ok: false, error: 'bad_response' } : { ok: true, days };
  } catch (error) {
    if (error instanceof SsrfError) return { ok: false, error: 'unreachable' };
    if (error instanceof Error && error.name === 'AbortError') return { ok: false, error: 'timeout' };
    // Never the cause: it can carry the URL, and one day a proxy's message could carry more.
    return { ok: false, error: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
