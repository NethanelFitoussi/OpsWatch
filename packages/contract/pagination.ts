/**
 * How a list answers, and how a client asks for the next page.
 *
 * A cursor is opaque to the client and keyed on an **immutable axis**: a monotonic `seq` assigned to the row when it
 * is inserted, with the row id as tiebreak. It is never keyed on a mutating value such as `lastSeenAt` or `score`,
 * because a row that moves between two requests makes a page skip or repeat rows. Severity and recency are sort
 * options applied *inside* a page; a "worst N" view is a bounded endpoint with no cursor at all.
 */
import { z } from 'zod';

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable().default(null) });
}
export type Page<T> = { items: T[]; nextCursor: string | null };

/** The page size a client may ask for. */
export const MIN_PAGE_SIZE = 1;
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 50;

/** The immutable axis a cursor names: the insertion sequence of a row, and the row id to break ties. */
export type CursorPosition = { seq: number; id: string };

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const CODES = new Map<string, number>([...ALPHABET].map((character, index) => [character, index]));

/**
 * base64url over an ASCII string, written out rather than taken from `Buffer` or `btoa`: the contract runs in
 * Node, in a browser and in React Native, and only one of the three has all three of those.
 */
function encodeBase64Url(ascii: string): string {
  let out = '';
  for (let i = 0; i < ascii.length; i += 3) {
    // Named rather than indexed, and `charAt` rather than `[]`: the mobile app compiles this file with
    // `noUncheckedIndexedAccess`, under which every index is `T | undefined`. The values here can never be missing —
    // the alphabet has 64 entries and the mask is `& 63` — so this says that in the types instead of asserting it.
    const first = ascii.charCodeAt(i);
    const second = ascii.charCodeAt(i + 1);
    const third = ascii.charCodeAt(i + 2);
    const chunk = (first << 16) | ((Number.isNaN(second) ? 0 : second) << 8) | (Number.isNaN(third) ? 0 : third);
    const length = ascii.length - i;
    out += ALPHABET.charAt((chunk >> 18) & 63) + ALPHABET.charAt((chunk >> 12) & 63);
    if (length > 1) out += ALPHABET.charAt((chunk >> 6) & 63);
    if (length > 2) out += ALPHABET.charAt(chunk & 63);
  }
  return out;
}

function decodeBase64Url(encoded: string): string | null {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const character of encoded) {
    const value = CODES.get(character);
    if (value === undefined) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
}

/**
 * The cursor a list answers with. The id is percent-encoded first so the payload is ASCII whatever the id holds,
 * which is what lets the base64url above stay this small.
 */
export function encodeCursor(position: CursorPosition): string {
  return encodeBase64Url(`${Math.trunc(position.seq)}.${encodeURIComponent(position.id)}`);
}

/** `null` for anything this server did not mint: a client never has to be trusted about where a page resumes. */
export function decodeCursor(cursor: string): CursorPosition | null {
  const decoded = decodeBase64Url(cursor);
  if (decoded === null) return null;
  const separator = decoded.indexOf('.');
  if (separator <= 0) return null;
  const seq = Number(decoded.slice(0, separator));
  if (!Number.isSafeInteger(seq) || seq < 0) return null;
  try {
    const id = decodeURIComponent(decoded.slice(separator + 1));
    return id.length > 0 ? { seq, id } : null;
  } catch {
    return null;
  }
}

/**
 * Which list endpoints of v1 are cursored and which are bounded, so neither side has to guess. A bounded endpoint
 * answers everything it has (its size is capped by the server) and never returns a `nextCursor` other than `null`.
 */
export const ENDPOINT_PAGINATION = {
  '/environments': 'bounded',
  '/me/sessions': 'bounded',
  '/me/favorites': 'bounded',
  '/services': 'bounded',
  '/infrastructure': 'bounded',
  '/synthetics': 'bounded',
  '/slos': 'bounded',
  '/cloudflare': 'bounded',
  '/search': 'bounded',
  '/problems': 'cursor',
  '/errors': 'cursor',
  '/alerts': 'cursor',
  '/incidents': 'cursor',
  '/deployments': 'cursor',
  '/logs/search': 'cursor',
} as const satisfies Record<string, 'cursor' | 'bounded'>;

export type PaginatedEndpoint = keyof typeof ENDPOINT_PAGINATION;

/**
 * The filters each list endpoint accepts, declared once so a client and the server cannot disagree about the
 * vocabulary — the same reason `ENDPOINT_PAGINATION` exists.
 *
 * This was added after a real failure. The mobile app sent `?status=&severity=&service=` to `/problems`; the
 * route read only `env`, `cursor` and `limit`, so every filter was dropped. Nothing errored. A chip lit up,
 * a full unfiltered page came back, and the list rendered unchanged — which an on-call reader would take as
 * "there is one critical problem" rather than "filtering did not happen". A silently ignored filter is worse
 * than a missing one, because the answer looks like an answer.
 *
 * Two rules follow, and both are enforced rather than documented:
 *
 * - **Only what the server honours is declared here.** Declaring a filter nobody implements would move the
 *   same bug one layer down.
 * - **Anything not declared is rejected**, so a client that asks for something the server will not do finds
 *   out rather than being handed a plausible wrong list.
 */
export const LIST_FILTERS = {
  '/problems': {
    /** Repeatable: `?status=new&status=active` means either. */
    status: 'enum',
    severity: 'enum',
    /** The service id as a summary reports it. */
    service: 'string',
    /** Epoch milliseconds; a problem is included when it was last seen at or after it. */
    since: 'epoch',
  },
  '/errors': {
    status: 'enum',
    service: 'string',
    since: 'epoch',
  },
} as const satisfies Record<string, Record<string, 'enum' | 'string' | 'epoch'>>;

export type FilteredEndpoint = keyof typeof LIST_FILTERS;
export type ListFilterKind = 'enum' | 'string' | 'epoch';

/** The parameters every list endpoint reads regardless, which a filter check must not reject. */
export const RESERVED_LIST_PARAMS = ['env', 'cursor', 'limit', 'locale'] as const;

/** Whether an endpoint declares filters at all, so a caller can tell "none allowed" from "not a list". */
export function filtersFor(path: string): Record<string, ListFilterKind> | null {
  return (LIST_FILTERS as Record<string, Record<string, ListFilterKind>>)[path] ?? null;
}
