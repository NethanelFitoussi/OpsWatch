import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { randomId } from '../crypto';
import type { Db } from '../db/client';
import { savedLogSearches, type SavedLogSearchRow } from '../db/schema';
import type { SavedSearchFields } from '../monitoring/shared/saved-search';
import { SAVED_SEARCHES_MAX } from '../monitoring/shared/saved-search';

/**
 * One person's saved log searches.
 *
 * **Every function takes `adminUserId` and every statement filters on it**, including the ones that already
 * have a primary key. An id is a guessable-enough handle, and "I know the id" must never be the same thing
 * as "this is mine": deleting by id alone would let one operator delete another's saved search with a
 * crafted form post. The ownership check is in the `where`, not in a caller that might forget it.
 */

export type SavedSearchScope = { connectionId: string; scope: string };

const owned = (adminUserId: number, scope: SavedSearchScope) =>
  and(
    eq(savedLogSearches.adminUserId, adminUserId),
    eq(savedLogSearches.connectionId, scope.connectionId),
    eq(savedLogSearches.scope, scope.scope),
  );

export function listSavedSearches(db: Db, adminUserId: number, scope: SavedSearchScope): SavedLogSearchRow[] {
  return db.select().from(savedLogSearches).where(owned(adminUserId, scope)).orderBy(asc(savedLogSearches.name)).all();
}

/** One saved search, or undefined — including when it exists and belongs to somebody else. */
export function getSavedSearch(db: Db, adminUserId: number, id: string): SavedLogSearchRow | undefined {
  return db
    .select()
    .from(savedLogSearches)
    .where(and(eq(savedLogSearches.id, id), eq(savedLogSearches.adminUserId, adminUserId)))
    .get();
}

export type SaveOutcome = { ok: true; row: SavedLogSearchRow } | { ok: false; error: 'name_taken' | 'too_many_saved' | 'not_found' };

export function createSavedSearch(
  db: Db,
  adminUserId: number,
  scope: SavedSearchScope,
  fields: SavedSearchFields,
  nowMs: number,
): SaveOutcome {
  const existing = listSavedSearches(db, adminUserId, scope);
  if (existing.length >= SAVED_SEARCHES_MAX) return { ok: false, error: 'too_many_saved' };
  if (existing.some((row) => row.name === fields.name)) return { ok: false, error: 'name_taken' };

  const row: SavedLogSearchRow = {
    id: randomId(),
    adminUserId,
    connectionId: scope.connectionId,
    scope: scope.scope,
    name: fields.name,
    searchText: fields.text,
    level: fields.level,
    limitRows: fields.limit,
    range: fields.range,
    logGroups: fields.logGroups,
    query: fields.query,
    createdAt: nowMs,
    updatedAt: nowMs,
  };
  db.insert(savedLogSearches).values(row).run();
  return { ok: true, row };
}

/** Replaces everything a saved search holds except who owns it and when it was created. */
export function updateSavedSearch(
  db: Db,
  adminUserId: number,
  id: string,
  fields: SavedSearchFields,
  nowMs: number,
): SaveOutcome {
  const current = getSavedSearch(db, adminUserId, id);
  if (current === undefined) return { ok: false, error: 'not_found' };
  const siblings = listSavedSearches(db, adminUserId, { connectionId: current.connectionId, scope: current.scope });
  if (siblings.some((row) => row.name === fields.name && row.id !== id)) return { ok: false, error: 'name_taken' };

  const row: SavedLogSearchRow = {
    ...current,
    name: fields.name,
    searchText: fields.text,
    level: fields.level,
    limitRows: fields.limit,
    range: fields.range,
    logGroups: fields.logGroups,
    query: fields.query,
    updatedAt: nowMs,
  };
  db.update(savedLogSearches)
    .set(row)
    .where(and(eq(savedLogSearches.id, id), eq(savedLogSearches.adminUserId, adminUserId)))
    .run();
  return { ok: true, row };
}

/** Whether anything was deleted. False for an id that is not there and for one that is somebody else's. */
export function deleteSavedSearch(db: Db, adminUserId: number, id: string): boolean {
  const result = db
    .delete(savedLogSearches)
    .where(and(eq(savedLogSearches.id, id), eq(savedLogSearches.adminUserId, adminUserId)))
    .run();
  return result.changes > 0;
}

/** The fields of a stored row, back in the shape the page and the validator use. */
export function fieldsOf(row: SavedLogSearchRow): SavedSearchFields {
  return {
    name: row.name,
    text: row.searchText,
    level: row.level as SavedSearchFields['level'],
    limit: row.limitRows,
    range: row.range as SavedSearchFields['range'],
    logGroups: row.logGroups,
    query: row.query,
  };
}
