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
    const bytes = [ascii.charCodeAt(i), ascii.charCodeAt(i + 1), ascii.charCodeAt(i + 2)];
    const chunk = (bytes[0] << 16) | ((Number.isNaN(bytes[1]) ? 0 : bytes[1]) << 8) | (Number.isNaN(bytes[2]) ? 0 : bytes[2]);
    const length = ascii.length - i;
    out += ALPHABET[(chunk >> 18) & 63] + ALPHABET[(chunk >> 12) & 63];
    if (length > 1) out += ALPHABET[(chunk >> 6) & 63];
    if (length > 2) out += ALPHABET[chunk & 63];
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
  '/search': 'bounded',
  '/problems': 'cursor',
  '/errors': 'cursor',
  '/alerts': 'cursor',
  '/incidents': 'cursor',
  '/deployments': 'cursor',
  '/logs/search': 'cursor',
} as const satisfies Record<string, 'cursor' | 'bounded'>;

export type PaginatedEndpoint = keyof typeof ENDPOINT_PAGINATION;
