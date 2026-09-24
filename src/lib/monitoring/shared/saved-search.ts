import { LOGS_TIME_RANGES, type LogsTimeRange } from './logs-queries';
import { LOG_LEVELS, ROW_LIMITS, SEARCH_TEXT_MAX, type LogLevel } from './logs-search';

/**
 * A saved log search: the shape of one, and the rules for what may be stored.
 *
 * Saving belongs to one person. Two operators looking at the same environment keep different lists, and
 * nothing here is shared, published or sent anywhere — it is a shortcut back to a search somebody ran.
 *
 * **Only a relative range is stored.** "The last hour" still means something next Tuesday; `12:00 to
 * 13:00 on 24 September` is a bookmark to a moment that will not come back, and a saved search that
 * silently searches a dead window is worse than no saved search.
 *
 * Pure: no clock, no database, no AWS. The bounds are here rather than in the store so the store cannot
 * be the only thing that enforces them, and so they can be tested without a database.
 */

export const SAVED_SEARCH_NAME_MAX = 80;
/** How many one person may keep per environment. A list nobody can find anything in is not a feature. */
export const SAVED_SEARCHES_MAX = 50;

export type SavedSearchFields = {
  name: string;
  /** The free text of the search box. Empty is legitimate: "every error in the last hour" has no text. */
  text: string;
  level: LogLevel | null;
  limit: number;
  range: LogsTimeRange;
  logGroups: string[];
  /** The raw Logs Insights query when the editor was used, or null when the search box built it. */
  query: string | null;
};

export type SavedSearchError =
  | 'name_required'
  | 'name_too_long'
  | 'no_groups'
  | 'too_many_groups'
  | 'invalid_range'
  | 'invalid_level'
  | 'invalid_limit'
  | 'query_too_long'
  | 'too_many_saved';

export type Normalised = { ok: true; value: SavedSearchFields } | { ok: false; error: SavedSearchError };

/**
 * Checks and trims what a form sent.
 *
 * Unknown values are refused rather than coerced. A range of `7d` is not clamped to `24h`, because a saved
 * search that quietly searches a different window than the one it was saved from is a lie with a name on it.
 */
export function normaliseSavedSearch(
  raw: {
    name: string;
    text: string;
    level: string | null;
    limit: number;
    range: string;
    logGroups: readonly string[];
    query: string | null;
  },
  limits: { maxGroups: number; maxQueryLength: number },
): Normalised {
  const name = raw.name.trim();
  if (name === '') return { ok: false, error: 'name_required' };
  if (name.length > SAVED_SEARCH_NAME_MAX) return { ok: false, error: 'name_too_long' };

  const logGroups = [...new Set(raw.logGroups.map((group) => group.trim()).filter((group) => group !== ''))];
  if (logGroups.length === 0) return { ok: false, error: 'no_groups' };
  if (logGroups.length > limits.maxGroups) return { ok: false, error: 'too_many_groups' };

  if (!(LOGS_TIME_RANGES as readonly string[]).includes(raw.range)) return { ok: false, error: 'invalid_range' };
  if (raw.level !== null && !(LOG_LEVELS as readonly string[]).includes(raw.level)) return { ok: false, error: 'invalid_level' };
  if (!(ROW_LIMITS as readonly number[]).includes(raw.limit)) return { ok: false, error: 'invalid_limit' };

  const query = raw.query === null || raw.query.trim() === '' ? null : raw.query;
  if (query !== null && query.length > limits.maxQueryLength) return { ok: false, error: 'query_too_long' };

  return {
    ok: true,
    value: {
      name,
      text: raw.text.trim().slice(0, SEARCH_TEXT_MAX),
      level: raw.level as LogLevel | null,
      limit: raw.limit,
      range: raw.range as LogsTimeRange,
      logGroups,
      query,
    },
  };
}

/**
 * A free name for a copy.
 *
 * `Payments errors` becomes `Payments errors (2)`, then `(3)`. It gives up and returns the base name past
 * the cap, where the caller's uniqueness check refuses it — better than looping for ever.
 */
export function duplicateName(base: string, taken: readonly string[]): string {
  const trimmed = base.trim();
  const room = SAVED_SEARCH_NAME_MAX - 4;
  const stem = trimmed.length > room ? trimmed.slice(0, room).trimEnd() : trimmed;
  for (let suffix = 2; suffix <= 99; suffix += 1) {
    const candidate = `${stem} (${suffix})`;
    if (!taken.includes(candidate)) return candidate;
  }
  return stem;
}

/** The search-page query string one saved search restores, so loading it is an ordinary navigation. */
export function savedSearchParams(fields: SavedSearchFields): string {
  const params = new URLSearchParams();
  if (fields.text !== '') params.set('q', fields.text);
  if (fields.level !== null) params.set('level', fields.level);
  params.set('limit', String(fields.limit));
  params.set('range', fields.range);
  for (const group of fields.logGroups) params.append('group', group);
  return params.toString();
}
