import 'server-only';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE, encodeCursor, type CursorPosition } from '@opswatch/contract';
import type { SeqPage } from '../store/problems';

/**
 * How a read service pages, and how its page becomes the contract's `{ items, nextCursor }`.
 *
 * The cursor axis is the store's, unchanged: an immutable `(seq, id)` pair (§33.6). This only translates it,
 * so the page a browser gets and the page a phone gets resume in exactly the same place.
 */
export const DEFAULT_PAGE_LIMIT = DEFAULT_PAGE_SIZE;
export const MAX_PAGE_LIMIT = MAX_PAGE_SIZE;

/** A bounded, uncursored view: §33.6's "worst N" endpoint, which returns a complete ranked set. */
export const TOP_PROBLEMS_LIMIT = 20;

/** Clamps whatever a caller asked for into the range the contract promises. */
export function pageLimit(asked: number | undefined): number {
  if (asked === undefined || !Number.isFinite(asked)) return DEFAULT_PAGE_LIMIT;
  return Math.min(MAX_PAGE_LIMIT, Math.max(MIN_PAGE_SIZE, Math.trunc(asked)));
}

/** The store's cursor shape, from the contract's. */
export function toStoreCursor(cursor: CursorPosition | null): { afterSeq: number; afterId: string } | null {
  return cursor === null ? null : { afterSeq: cursor.seq, afterId: cursor.id };
}

/** One page of anything the store paged, mapped into the shape every client already parses. */
export function toPage<Row, Item>(page: SeqPage<Row>, map: (row: Row) => Item): { items: Item[]; nextCursor: string | null } {
  return {
    items: page.items.map(map),
    nextCursor:
      page.nextSeq === null || page.nextId === null ? null : encodeCursor({ seq: page.nextSeq, id: page.nextId }),
  };
}
