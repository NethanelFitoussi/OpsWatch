'use server';

import { revalidatePath } from 'next/cache';
import { resolveLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/auth/current';
import { getDb } from '@/lib/db/client';
import type { ActionState } from '@/lib/forms/action-state';
import { formString, formStrings } from '@/lib/forms/form-data';
import { LOGS_MAX_GROUPS, LOGS_MAX_QUERY_LENGTH } from '@/lib/monitoring/logs';
import { SAVED_SEARCH_NAME_MAX, duplicateName, normaliseSavedSearch, type SavedSearchError } from '@/lib/monitoring/shared/saved-search';
import {
  createSavedSearch,
  deleteSavedSearch,
  fieldsOf,
  getSavedSearch,
  listSavedSearches,
  updateSavedSearch,
} from '@/lib/store/saved-searches';

/**
 * Saving, renaming, updating, duplicating and deleting a log search.
 *
 * Three things every action here does, in this order, before it touches anything:
 *   1. **`requireAdmin`** — signed in, or redirected to the login page;
 *   2. **the store's own ownership filter** — every statement is `where id = ? and admin_user_id = ?`, so
 *      a crafted post carrying somebody else's id finds nothing rather than editing their search;
 *   3. **`normaliseSavedSearch`** — the same bounds the query API enforces, applied before storage rather
 *      than after it.
 *
 * None of this is audited. §21 records what an administrator does to the *installation*; a personal
 * shortcut to a search is not that, and filling the audit log with bookmarks would bury what is.
 */

export type SavedSearchState = ActionState<SavedSearchError | 'name_taken' | 'not_found', { savedId?: string; deleted?: boolean }>;

const LIMITS = { maxGroups: LOGS_MAX_GROUPS, maxQueryLength: LOGS_MAX_QUERY_LENGTH };

/** Everything the search form carries, as the validator wants it. */
function readFields(formData: FormData) {
  const level = formString(formData, 'level');
  const query = formString(formData, 'query');
  return {
    name: formString(formData, 'name').slice(0, SAVED_SEARCH_NAME_MAX + 1),
    text: formString(formData, 'q'),
    level: level === '' ? null : level,
    limit: Number(formString(formData, 'limit')),
    range: formString(formData, 'range'),
    logGroups: formStrings(formData, 'group'),
    query: query === '' ? null : query,
  };
}

function refresh(locale: string, connectionId: string, region: string) {
  revalidatePath(`/${resolveLocale(locale)}/c/${connectionId}/${region}/logs/search`);
}

export async function saveSearchAction(
  locale: string,
  connectionId: string,
  region: string,
  _prev: SavedSearchState,
  formData: FormData,
): Promise<SavedSearchState> {
  const adminId = await requireAdmin(resolveLocale(locale));
  const checked = normaliseSavedSearch(readFields(formData), LIMITS);
  if (!checked.ok) return { error: checked.error };

  // An id means "update the one I already have"; without one this is a new saved search.
  const id = formString(formData, 'id');
  const outcome =
    id === ''
      ? createSavedSearch(getDb(), adminId, { connectionId, scope: region }, checked.value, Date.now())
      : updateSavedSearch(getDb(), adminId, id, checked.value, Date.now());
  if (!outcome.ok) return { error: outcome.error };

  refresh(locale, connectionId, region);
  return { savedId: outcome.row.id };
}

/**
 * A copy of an existing saved search, under a free name.
 *
 * The copy is made from what is **stored**, not from what the form sent: duplicating is "give me another
 * one of these", and taking the browser's current unsaved edits would silently make a copy of something
 * the person never saved.
 */
export async function duplicateSearchAction(
  locale: string,
  connectionId: string,
  region: string,
  _prev: SavedSearchState,
  formData: FormData,
): Promise<SavedSearchState> {
  const adminId = await requireAdmin(resolveLocale(locale));
  const db = getDb();
  const source = getSavedSearch(db, adminId, formString(formData, 'id'));
  if (source === undefined) return { error: 'not_found' };

  const taken = listSavedSearches(db, adminId, { connectionId: source.connectionId, scope: source.scope }).map((row) => row.name);
  const outcome = createSavedSearch(
    db,
    adminId,
    { connectionId: source.connectionId, scope: source.scope },
    { ...fieldsOf(source), name: duplicateName(source.name, taken) },
    Date.now(),
  );
  if (!outcome.ok) return { error: outcome.error };

  refresh(locale, connectionId, region);
  return { savedId: outcome.row.id };
}

export async function deleteSearchAction(
  locale: string,
  connectionId: string,
  region: string,
  _prev: SavedSearchState,
  formData: FormData,
): Promise<SavedSearchState> {
  const adminId = await requireAdmin(resolveLocale(locale));
  // False for an id that is not there and for one that belongs to somebody else — the same answer, because
  // telling the two apart would confirm that somebody else's saved search exists.
  if (!deleteSavedSearch(getDb(), adminId, formString(formData, 'id'))) return { error: 'not_found' };
  refresh(locale, connectionId, region);
  return { deleted: true };
}
