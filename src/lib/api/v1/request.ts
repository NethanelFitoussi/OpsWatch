import 'server-only';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MIN_PAGE_SIZE,
  type ApiErrorCode,
  type CursorPosition,
  decodeCursor,
  filtersFor,
  parseEnvironmentId,
  RESERVED_LIST_PARAMS,
  type FilteredEndpoint,
} from '@opswatch/contract';

/**
 * How `/api/v1` reads a request. Fixed here once, so every endpoint that ships later asks for a page and for an
 * environment in exactly the same way and answers the same code when a client gets it wrong.
 */
export type Pagination = { ok: true; limit: number; cursor: CursorPosition | null } | { ok: false; error: ApiErrorCode };

/**
 * `?cursor=<opaque>&limit=<1…100>`, and nothing else. There is no offset: a page is resumed from an immutable
 * `(seq, id)` pair, so a row inserted or rescored between two requests can neither hide a row nor repeat one.
 */
export function parsePagination(url: URL): Pagination {
  const raw = url.searchParams.get('limit');
  let limit = DEFAULT_PAGE_SIZE;
  if (raw !== null) {
    if (!/^\d+$/.test(raw)) return { ok: false, error: 'invalid_request' };
    limit = Number(raw);
    if (limit < MIN_PAGE_SIZE || limit > MAX_PAGE_SIZE) return { ok: false, error: 'invalid_request' };
  }
  const encoded = url.searchParams.get('cursor');
  if (encoded === null) return { ok: true, limit, cursor: null };
  const cursor = decodeCursor(encoded);
  return cursor === null ? { ok: false, error: 'invalid_cursor' } : { ok: true, limit, cursor };
}

export type EnvironmentParam =
  | { ok: true; environment: { connectionId: string; scope: string } | null }
  | { ok: false; error: ApiErrorCode };

/**
 * `?env=<connectionId>:<scope>`, the pair every data call is scoped to. Absent is allowed and answers `null`: the
 * endpoints that need one say so themselves, and the ones that do not are unaffected. Only the shape is checked
 * here — whether that connection exists and has that region is a database question, asked after the session.
 */
export function parseEnvironmentParam(url: URL): EnvironmentParam {
  const value = url.searchParams.get('env');
  if (value === null) return { ok: true, environment: null };
  const parsed = parseEnvironmentId(value);
  return parsed === null ? { ok: false, error: 'invalid_request' } : { ok: true, environment: parsed };
}

/**
 * `?status=&severity=&service=&since=`, validated against the contract's `LIST_FILTERS`.
 *
 * The rule this enforces is that an unknown or invalid filter is a **stated failure**, never a silent drop.
 * A client that asks for something this server will not do gets `invalid_request` and can fix it; the
 * alternative — returning a full unfiltered page to a request that asked for a filtered one — hands back an
 * answer that looks correct and is not.
 */
export type ListFilters =
  | { ok: true; status: string[] | null; severity: string[] | null; service: string | null; sinceMs: number | null }
  | { ok: false; error: ApiErrorCode };

export function parseListFilters(url: URL, path: FilteredEndpoint): ListFilters {
  const allowed = filtersFor(path) ?? {};
  const reserved = new Set<string>(RESERVED_LIST_PARAMS);

  for (const name of new Set(url.searchParams.keys())) {
    // Unknown here means "this endpoint does not filter on that", which is a question, not a preference.
    if (!reserved.has(name) && !(name in allowed)) return { ok: false, error: 'invalid_request' };
  }

  const values = (name: string): string[] | null => {
    if (!(name in allowed)) return null;
    const all = url.searchParams.getAll(name).flatMap((one) => one.split(',')).map((one) => one.trim()).filter((one) => one !== '');
    return all.length === 0 ? null : all;
  };

  const status = values('status');
  const severity = values('severity');
  const service = values('service');
  // A repeated `service` would be ambiguous rather than a union, so it is refused instead of guessed at.
  if (service !== null && service.length > 1) return { ok: false, error: 'invalid_request' };

  let sinceMs: number | null = null;
  const since = url.searchParams.get('since');
  if (since !== null && 'since' in allowed) {
    if (!/^\d+$/.test(since)) return { ok: false, error: 'invalid_request' };
    sinceMs = Number(since);
    if (!Number.isFinite(sinceMs)) return { ok: false, error: 'invalid_request' };
  }

  return { ok: true, status, severity, service: service?.[0] ?? null, sinceMs };
}

/**
 * A filter whose values must all come from a closed list.
 *
 * One unknown value fails the whole request rather than being quietly dropped — dropping it would answer a
 * narrower question than the one asked, which is the failure this whole mechanism exists to prevent.
 */
export function enumFilter<T extends string>(raw: readonly string[] | null, allowed: readonly T[]): { ok: true; values?: T[] } | { ok: false } {
  if (raw === null) return { ok: true };
  const kept = raw.filter((one): one is T => (allowed as readonly string[]).includes(one));
  return kept.length === raw.length ? { ok: true, values: kept } : { ok: false };
}
