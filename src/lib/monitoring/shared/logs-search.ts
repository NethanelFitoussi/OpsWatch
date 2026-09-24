/**
 * Turning "what am I looking for" into a CloudWatch Logs Insights query, and turning what came back into
 * something readable — without ever claiming more than the rows actually support.
 *
 * The page this serves is a search box, not a query console. Somebody types `timeout`, picks a level and a
 * range, and gets logs. The query that was really sent stays visible, because a search box that hides what
 * it ran is a search box you cannot debug.
 *
 * Pure: strings and numbers in, strings and numbers out. No clock, no AWS, no database.
 */

/** The levels OpsWatch can recognise in a log line. Not a taxonomy — the four words that actually appear. */
export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** How many rows a search asks for. The API caps at `LOGS_MAX_ROWS`; these are the choices offered. */
export const ROW_LIMITS = [100, 500, 1000] as const;
export const DEFAULT_ROW_LIMIT = 100;

/** The free-text box is bounded long before the query-length cap, because a search term is not an essay. */
export const SEARCH_TEXT_MAX = 200;

/**
 * The row limit from a URL, which is whatever somebody pasted into the address bar.
 *
 * Anything that is not one of the offered choices becomes the default rather than being clamped into range:
 * `limit=999999` is not a request for a thousand rows, it is a malformed link.
 */
export function parseRowLimit(value: string | null | undefined): number {
  const asked = Number(value);
  return (ROW_LIMITS as readonly number[]).includes(asked) ? asked : DEFAULT_ROW_LIMIT;
}

export type LogsSearchSpec = {
  /** Plain text, matched anywhere in the message, case-insensitively. Empty means "everything". */
  text: string;
  /** One level, or null for every line whatever it says. */
  level: LogLevel | null;
  limit: number;
};

/**
 * The words each level is recognised by, in the order a line is tested.
 *
 * `error` before `warn` because a line saying "error, will retry with warning" is an error. These are the
 * tokens real loggers emit; nothing here tries to infer severity from prose.
 */
const LEVEL_WORDS: Record<LogLevel, readonly string[]> = {
  error: ['error', 'err', 'fatal', 'critical', 'exception', 'panic', 'severe'],
  warn: ['warn', 'warning'],
  info: ['info', 'notice'],
  debug: ['debug', 'trace', 'verbose'],
};

/**
 * Escapes text for use inside a Logs Insights regex literal.
 *
 * Every metacharacter is escaped, including the `/` that would otherwise close the literal. A search for
 * `GET /v1/users` must look for that string, not for a pattern — and must not be able to end the regex and
 * continue the query with something the person did not ask for.
 */
export function escapeRegexLiteral(text: string): string {
  return text.replace(/[\\^$.|?*+()[\]{}\/]/g, (character) => `\\${character}`);
}

/** Whether the text is worth putting in a filter at all. Whitespace alone is not a search term. */
export function hasSearchText(text: string): boolean {
  return text.trim().length > 0;
}

/**
 * The query a search runs.
 *
 * Deterministic and always shown to the person who ran it. `(?i)` is Logs Insights' own case-insensitivity
 * flag, so `timeout` finds `Timeout` — which is what a search box is expected to do and what a `like "…"`
 * string literal would not.
 */
export function buildSearchQuery(spec: LogsSearchSpec): string {
  const parts = ['fields @timestamp, @logStream, @message'];
  const text = spec.text.trim().slice(0, SEARCH_TEXT_MAX);
  if (text !== '') parts.push(`filter @message like /(?i)${escapeRegexLiteral(text)}/`);
  if (spec.level !== null) parts.push(`filter @message like /(?i)(${LEVEL_WORDS[spec.level].join('|')})/`);
  parts.push('sort @timestamp desc');
  parts.push(`limit ${Math.trunc(spec.limit)}`);
  return parts.join(' | ');
}

/**
 * The level a line announces, or null.
 *
 * Null is a real answer: plenty of log lines carry no level, and colouring them as `info` would be inventing
 * a severity nobody wrote. Matching is on word boundaries built by hand, because the target is ES2017 and a
 * lookbehind is not available.
 */
export function detectLevel(message: string): LogLevel | null {
  const words = message.toLowerCase().split(/[^a-z]+/);
  for (const level of LOG_LEVELS) {
    if (words.some((word) => LEVEL_WORDS[level].includes(word))) return level;
  }
  return null;
}

/**
 * The instant a Logs Insights row is from, in epoch milliseconds, or null.
 *
 * `@timestamp` comes back as `2026-09-24 12:00:00.000` with no zone, and Logs Insights states it in UTC.
 * Letting `Date.parse` guess would read it as local time and slide every row by the browser's offset.
 */
export function rowTimeMs(value: string | undefined): number | null {
  if (value === undefined) return null;
  const text = value.trim();
  // Some clients — and the emulator the end-to-end suite runs against — send epoch milliseconds instead.
  // Only a 12-to-14-digit integer is read that way: a shorter number is far more likely to be an id than
  // a date in 1973, and reading it as one would put a bar at the left edge of every timeline.
  if (/^\d{12,14}$/.test(text)) return Number(text);
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(text);
  if (match === null) return null;
  const ms = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
    Number((match[7] ?? '0').padEnd(3, '0')),
  );
  return Number.isFinite(ms) ? ms : null;
}

export type Bucket = { startMs: number; endMs: number; count: number };

/**
 * The rows spread over a window, as equal buckets.
 *
 * A row outside the window is dropped rather than clamped into the first or last bucket, because a bar that
 * absorbs everything older than the window is a lie about when those events happened.
 */
export function bucketise(times: readonly number[], window: { startMs: number; endMs: number }, count: number): Bucket[] {
  const span = window.endMs - window.startMs;
  if (count <= 0 || span <= 0) return [];
  const width = span / count;
  const buckets: Bucket[] = Array.from({ length: count }, (_, index) => ({
    startMs: Math.round(window.startMs + index * width),
    endMs: Math.round(window.startMs + (index + 1) * width),
    count: 0,
  }));
  for (const time of times) {
    if (time < window.startMs || time > window.endMs) continue;
    // The last bucket owns its own right edge, so the newest event is never dropped off the end.
    const index = Math.min(count - 1, Math.floor((time - window.startMs) / width));
    buckets[index].count += 1;
  }
  return buckets;
}

/**
 * What the rows on screen are, relative to what matched.
 *
 * `complete` — every matching record came back, so a count drawn from the rows is the count.
 * `sample` — the limit cut the result, so anything derived from the rows describes the sample only.
 * `aggregated` — a `stats` query: there are no records to count, only the aggregation AWS computed.
 *
 * Nothing on the page may present a `sample` figure as a total. That is the difference between "there were
 * three errors" and "three of the hundred lines we fetched were errors".
 */
export type Population = 'complete' | 'sample' | 'aggregated';

export function populationOf(results: { fields: readonly string[]; rows: readonly unknown[]; recordsMatched: number }): Population {
  // A `stats` query returns its own columns and no `@timestamp`; `recordsMatched` then counts the records it
  // aggregated, not rows anybody can list. A result with no rows at all names no fields either, and that is
  // an empty search rather than an aggregation.
  if (results.rows.length > 0 && !results.fields.includes('@timestamp')) return 'aggregated';
  return results.rows.length >= results.recordsMatched ? 'complete' : 'sample';
}

export type Facet = { value: string; count: number };

/**
 * How often each value of one field appears in the rows given, most frequent first.
 *
 * Only ever over the rows in hand: the caller states which population that is. Rows with no value for the
 * field are left out rather than counted under an empty label.
 */
export function facetOf(rows: readonly Record<string, string>[], field: string, limit = 8): Facet[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = row[field];
    if (value === undefined || value === '') continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, limit);
}

/** The level breakdown of the rows in hand. Lines with no level are counted as such, never as `info`. */
export function levelCounts(rows: readonly Record<string, string>[]): { level: LogLevel | null; count: number }[] {
  const counts = new Map<LogLevel | null, number>();
  for (const row of rows) {
    const level = detectLevel(row['@message'] ?? '');
    counts.set(level, (counts.get(level) ?? 0) + 1);
  }
  return [...LOG_LEVELS, null]
    .filter((level) => counts.has(level))
    .map((level) => ({ level, count: counts.get(level) ?? 0 }));
}

/**
 * Why there is nothing on screen — which is four different facts that a single "No results" would merge.
 *
 * `not_run` — nobody has searched yet.
 * `no_groups` — no log group is selected, so there is nothing to search.
 * `failed` — the search could not run, and the error says why.
 * `no_match` — the search ran over real log groups and nothing matched.
 *
 * "No logs were collected" is deliberately not in this list: OpsWatch cannot tell an empty log group from a
 * group it was not allowed to read, and the picker is where that is answered.
 */
export type EmptyReason = 'not_run' | 'no_groups' | 'failed' | 'no_match';

export function emptyReason(state: { groups: number; ran: boolean; failed: boolean; rows: number }): EmptyReason | null {
  if (state.groups === 0) return 'no_groups';
  if (!state.ran) return 'not_run';
  if (state.failed) return 'failed';
  return state.rows === 0 ? 'no_match' : null;
}
