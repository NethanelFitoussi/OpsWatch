import 'server-only';
import { SsrfError, safeFetch } from '../net/safe-fetch';
import { CLOUDFLARE_FAILURES } from './failures';

/**
 * Talking to Cloudflare (§20, CF-1).
 *
 * Everything that could carry the token is confined here. It is passed as an argument, put into one header,
 * and never logged, returned or placed in an error — failures are a closed set of codes, so nothing
 * Cloudflare says can reach a page (§12.6).
 *
 * The base URL is fixed rather than configurable: unlike an AI provider, there is one Cloudflare, and a
 * settings field for its address would be an invitation to point a token somewhere else.
 */

const BASE_URL = 'https://api.cloudflare.com/client/v4';
const TIMEOUT_MS = 15_000;

/** How many zones one discovery call returns. An account with hundreds is paged by the operator's choice. */
export const ZONE_PAGE_SIZE = 50;

export type CloudflareFailure = (typeof CLOUDFLARE_FAILURES)[number];

export type CloudflareResult<T> = { ok: true; data: T } | { ok: false; error: CloudflareFailure };

/** The permissions a token carries, as Cloudflare reports them on verification. */
export type TokenStatus = { status: string };

export type Zone = { id: string; name: string; status: string };

export type CloudflareDeps = { fetch?: typeof safeFetch; timeoutMs?: number };

function failureOf(status: number): CloudflareFailure {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  return 'bad_response';
}

/**
 * One call. Cloudflare wraps every answer in `{ success, result, errors }`, and a 200 with
 * `success: false` is a failure — reading only the HTTP status would report an error as data.
 */
async function call<T>(path: string, token: string, parse: (result: unknown) => T | null, deps: CloudflareDeps): Promise<CloudflareResult<T>> {
  const send = deps.fetch ?? safeFetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? TIMEOUT_MS);

  try {
    const response = await send(`${BASE_URL}${path}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, error: failureOf(response.status) };

    const payload: unknown = await response.json().catch(() => null);
    if (typeof payload !== 'object' || payload === null) return { ok: false, error: 'bad_response' };
    const body = payload as { success?: unknown; result?: unknown };
    if (body.success !== true) return { ok: false, error: 'bad_response' };

    const data = parse(body.result);
    return data === null ? { ok: false, error: 'bad_response' } : { ok: true, data };
  } catch (error) {
    // The guard refused the address — it cannot happen with a fixed base URL, and is handled rather than
    // left to fall through as a generic network error if that ever stops being true.
    if (error instanceof SsrfError) return { ok: false, error: 'unreachable' };
    if (error instanceof Error && error.name === 'AbortError') return { ok: false, error: 'timeout' };
    // Never the cause: it can carry the URL, and one day a proxy's error could carry more.
    return { ok: false, error: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

/** §20's permission validation: does this token work, and is it live. */
export function verifyToken(token: string, deps: CloudflareDeps = {}): Promise<CloudflareResult<TokenStatus>> {
  return call(
    '/user/tokens/verify',
    token,
    (result) => {
      if (typeof result !== 'object' || result === null) return null;
      const status = (result as { status?: unknown }).status;
      return typeof status === 'string' ? { status } : null;
    },
    deps,
  );
}

/** The zones this token can see. Discovery, so an operator picks from what exists rather than typing ids. */
export function listZones(token: string, deps: CloudflareDeps = {}): Promise<CloudflareResult<Zone[]>> {
  return call(
    `/zones?per_page=${ZONE_PAGE_SIZE}`,
    token,
    (result) => {
      if (!Array.isArray(result)) return null;
      return result
        .filter((zone): zone is { id: string; name: string; status?: string } =>
          typeof zone === 'object' && zone !== null && typeof (zone as { id?: unknown }).id === 'string' && typeof (zone as { name?: unknown }).name === 'string',
        )
        .map((zone) => ({ id: zone.id, name: zone.name, status: typeof zone.status === 'string' ? zone.status : 'unknown' }));
    },
    deps,
  );
}
