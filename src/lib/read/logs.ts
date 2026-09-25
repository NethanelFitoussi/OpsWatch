import 'server-only';
import type { LogEntry, LogSearch, LogSearchRequest, LogSource } from '@opswatch/contract';
import type { LogGroup, LogsQueryResults } from '../monitoring/logs';
import { buildSearchQuery, detectLevel, rowTimeMs, type LogLevel } from '../monitoring/shared/logs-search';

/**
 * What `/api/v1/logs` answers, built from what the browser's own search already reads.
 *
 * One rule runs through all of it: **a sample is never presented as a total, and "not finished" is never
 * presented as "nothing found".** Logs Insights answers with as many lines as the query's `limit` allowed
 * and separately with how many matched; printing the first as the answer is the difference between "there
 * were three errors" and "here are three of the four hundred errors". So the status carries `partial`, and
 * a search still running carries `running` with no lines rather than an empty result.
 */

/** The four levels the search filter offers, mapped onto the contract's wider list. */
const REQUEST_LEVELS: Record<string, LogLevel> = { error: 'error', warn: 'warn', info: 'info', debug: 'debug' };

/** One log group, as the API names it. */
export function toLogSource(group: LogGroup): LogSource {
  return {
    name: group.name,
    // `null`, never `0`: a name search answers without sizes, and zero would claim the group is empty.
    storedBytes: group.storedBytes,
    // `null` is "kept for ever", which is not a retention of zero days.
    retentionDays: group.retentionDays,
  };
}

/**
 * The Logs Insights query the server composes for a request.
 *
 * The caller does not send query text, and this is why: a query string could aggregate into a shape the
 * result has no room for, or name log groups the caller never asked about. The server builds it from
 * values it has already bounded, and returns it in the answer so the search is visible rather than magic.
 */
export function queryFor(request: LogSearchRequest, limit: number): string {
  const level = request.level ?? null;
  return buildSearchQuery({
    text: request.text ?? '',
    // `fatal` and `unknown` are levels a *line* can announce; they are not filters the query builder has.
    level: level === null ? null : (REQUEST_LEVELS[level] ?? null),
    limit,
  });
}

/**
 * One Logs Insights row as a `LogEntry`.
 *
 * The id is OpsWatch's own, and local to this search: `@ptr` — AWS's own pointer — is dropped before the
 * results ever leave `getLogsQueryResults`, and fetching a single record by it needs `logs:GetLogRecord`,
 * which the read-only role does not grant. An id that cannot be fetched again is still worth having: it
 * gives a client a stable key for a list it is rendering.
 */
export function toLogEntry(row: Record<string, string>, searchId: string, index: number): LogEntry {
  const message = row['@message'] ?? '';
  const at = rowTimeMs(row['@timestamp']);
  const stream = row['@logStream'];
  // Every field but the three the query asked for, so a structured line keeps what it carried.
  const fields = Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('@')));
  return {
    id: `${searchId}:${index}`,
    // The row had no readable timestamp, so the search's own instant is not invented for it: 0 would be
    // 1970, and a client sorting on it would put the line at the beginning of time. There is no nullable
    // timestamp in the contract, so a row without one is dropped by the caller instead.
    timestamp: at ?? 0,
    level: detectLevel(message) ?? 'unknown',
    message,
    ...(stream === undefined ? {} : { source: stream }),
    ...(Object.keys(fields).length === 0 ? {} : { fields }),
  };
}

/**
 * The search as a whole.
 *
 * `partial` is not decoration: it is the difference between an answer and a sample, and a client that
 * cannot tell them apart will print the sample as the total.
 */
export function toLogSearch(searchId: string, query: string | null, results: LogsQueryResults): LogSearch {
  const running = results.status === 'Scheduled' || results.status === 'Running';
  // A row with no readable instant is dropped rather than dated to 1970.
  const items = results.rows
    .map((row, index) => toLogEntry(row, searchId, index))
    .filter((entry) => entry.timestamp > 0);
  const sampled = results.statistics.recordsMatched > items.length;

  const status = running
    ? ('running' as const)
    : results.status === 'Complete'
      ? sampled
        ? ('partial' as const)
        : ('complete' as const)
      : // Failed, Cancelled, Timeout and Unknown are all "this search did not answer". None of them may
        // read as `complete`, because a client would then show no lines as "nothing matched".
        ('failed' as const);

  return {
    searchId,
    status,
    // Nothing yet, rather than nothing found: the status says which it is.
    items: running ? [] : items,
    // There is no second page: Logs Insights answers once, bounded by the limit the search asked for.
    nextCursor: null,
    statistics: { recordsMatched: results.statistics.recordsMatched, recordsScanned: results.statistics.recordsScanned },
    /*
     * The search itself, so a caller can see what ran rather than infer it from what it asked for.
     *
     * Omitted rather than empty on a poll: AWS remembers the query and OpsWatch remembers only who may
     * ask, so a poll genuinely does not know it. `query: ''` would say the search was for nothing.
     */
    ...(query === null || query === '' ? {} : { query }),
  };
}
