import 'server-only';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MIN_PAGE_SIZE,
  type ApiErrorCode,
  type CursorPosition,
  decodeCursor,
  parseEnvironmentId,
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
