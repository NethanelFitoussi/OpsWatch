'use client';

import { Loader2, Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { usePathname, useRouter } from '@/i18n/navigation';
import { createLogsApi, type ClientQueryResults, type LogsClientError } from '@/lib/monitoring/shared/logs-api';
import { runLogsQuery } from '@/lib/monitoring/shared/logs-poller';
import { EXAMPLE_QUERIES, EXAMPLE_QUERY_KEYS, LOGS_TIME_RANGES, type LogsTimeRange } from '@/lib/monitoring/shared/logs-queries';
import {
  LOG_LEVELS,
  ROW_LIMITS,
  SEARCH_TEXT_MAX,
  bucketise,
  buildSearchQuery,
  detectLevel,
  emptyReason,
  facetOf,
  levelCounts,
  populationOf,
  rowTimeMs,
  type LogLevel,
} from '@/lib/monitoring/shared/logs-search';
import { withGroups } from '@/lib/monitoring/shared/logs-selection';
import { RANGE_SECONDS } from '@/lib/monitoring/shared/time-range';
import { isOneOf } from '@/lib/type-guards';
import { SavedSearches, type SavedRow, type SavedSearchActions } from './saved-searches';
import { LogsFacets, type FacetFilter } from './logs-facets';
import { LogsRows } from './logs-rows';
import { LogsTimeline } from './logs-timeline';
import { useLogsSelection } from './logs-selection';

/**
 * The Logs explorer.
 *
 * It used to be a Logs Insights console: to see a log line you had to know the query language. The search
 * box builds the query instead — and then shows it, because a search box that hides what it ran cannot be
 * debugged, and because the query is what an operator pastes into a ticket. Anyone who wants the language
 * back opens the advanced editor, which is the editor that was always here.
 *
 * What it refuses to do:
 *   - call an empty result "no logs". A search that matched nothing, a search that could not run, and a
 *     log group nobody has written to are three different facts, and each gets its own sentence;
 *   - present a figure taken from the rows in hand as a total when the limit cut them short;
 *   - colour anything green. Nothing on this page is a health verdict.
 */

/** Error codes of the Logs routes that have their own message; anything else falls back to the generic one. */
const SIMPLE_ERROR_CODES = ['invalid_query', 'range_too_long', 'unauthorized'] as const;

/** How often the elapsed time reaches the live region, whatever the poll interval is. */
const ANNOUNCE_EVERY_MS = 5000;

/** How many bars the timeline is drawn with. Enough to show shape, few enough to stay legible at 360px. */
const TIMELINE_BUCKETS = 32;

const RUN_HINT_ID = 'logs-run-hint';

type Phase = 'idle' | 'running' | 'done';
type Message = { kind: 'status' | 'error'; text: string };
/** The results, plus the window they were asked over — the timeline's axis is that window, not "now". */
type Run = { results: ClientQueryResults; startMs: number; endMs: number; query: string };

export function LogsExplorer({
  connectionId,
  region,
  range,
  maxQueryLength,
  initial,
  groupPicker,
  saved,
}: {
  connectionId: string;
  region: string;
  range: LogsTimeRange;
  maxQueryLength: number;
  initial: { text: string; level: LogLevel | null; limit: number };
  groupPicker: ReactNode;
  saved: { rows: SavedRow[]; basePath: string; actions: SavedSearchActions };
}) {
  const t = useTranslations('Monitoring.client');
  const { selected: groups } = useLogsSelection();

  const [text, setText] = useState(initial.text);
  const [level, setLevel] = useState<LogLevel | null>(initial.level);
  const [limit, setLimit] = useState(initial.limit);
  const [advanced, setAdvanced] = useState(false);
  const [advancedQuery, setAdvancedQuery] = useState(() => buildSearchQuery({ text: initial.text, level: initial.level, limit: initial.limit }));

  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [run, setRun] = useState<Run | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [facetFilter, setFacetFilter] = useState<FacetFilter>({ level: null, stream: null });
  const controllerRef = useRef<AbortController | null>(null);
  const queryIdRef = useRef<string | null>(null);

  // Leaving the page (unmount or a browser navigation) stops the query instead of letting AWS keep scanning.
  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => {
    const onPageHide = () => {
      const queryId = queryIdRef.current;
      // Nothing can be shown or retried at unload, so a failing stop is swallowed exactly as the poller swallows it.
      if (queryId) void createLogsApi(connectionId, region).stop(queryId).catch(() => undefined);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [connectionId, region]);

  /** The query that will run, always visible, never guessed at. */
  const query = advanced ? advancedQuery : buildSearchQuery({ text, level, limit });

  /**
   * The search state rides in the URL so the back button, a reload and a pasted link all restore the same
   * screen. It is written through the History API for the same reason the selection is: re-rendering the
   * server tree on every keystroke would fetch the log-group list from AWS again.
   */
  const remember = useCallback(() => {
    const params = new URLSearchParams(withGroups(window.location.search, groups));
    if (text.trim() === '') params.delete('q');
    else params.set('q', text.trim().slice(0, SEARCH_TEXT_MAX));
    if (level === null) params.delete('level');
    else params.set('level', level);
    params.set('limit', String(limit));
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}${window.location.hash}`);
  }, [groups, level, limit, text]);

  const search = useCallback(
    async (searchQuery: string) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setPhase('running');
      setElapsed(0);
      setRun(null);
      setMessage(null);
      setFacetFilter({ level: null, stream: null });
      remember();

      const endSeconds = Math.floor(Date.now() / 1000);
      const startSeconds = endSeconds - RANGE_SECONDS[range];
      const window_ = { startMs: startSeconds * 1000, endMs: endSeconds * 1000, query: searchQuery };
      const outcome = await runLogsQuery({
        api: createLogsApi(connectionId, region),
        input: { logGroups: groups, query: searchQuery, startSeconds, endSeconds },
        signal: controller.signal,
        onStarted: (queryId) => {
          queryIdRef.current = queryId;
        },
        onProgress: (polled, elapsedMs) => {
          setRun({ results: polled, ...window_ });
          setElapsed(elapsedMs);
        },
      });
      // Only an outcome AWS ended by itself proves the query is over. After a timeout, an abort or a poll error
      // the poller asked for a stop that may have failed, so the id stays and `pagehide` can ask once more.
      if (outcome.kind === 'complete' || outcome.kind === 'ended') queryIdRef.current = null;
      setPhase('done');

      const errorText = ({ code, action, awsCode }: LogsClientError): string => {
        if (code === 'aws_denied') return t('logs.errors.denied', { action: action ?? '' });
        if (code === 'aws_throttled') return t('logs.errors.throttled');
        if (code === 'aws_error') return t('logs.errors.aws', { code: awsCode ?? '' });
        if (isOneOf(SIMPLE_ERROR_CODES, code)) return t(`logs.errors.${code}`);
        return t('logs.errors.generic');
      };

      switch (outcome.kind) {
        case 'complete':
          setRun({ results: outcome.results, ...window_ });
          setMessage({
            kind: 'status',
            text: t('logs.status.complete', { rows: outcome.results.rows.length, records: outcome.results.statistics.recordsScanned }),
          });
          break;
        case 'ended':
          setRun({ results: outcome.results, ...window_ });
          setMessage({ kind: 'error', text: t('logs.status.failed', { status: outcome.status }) });
          break;
        case 'timeout':
          setMessage({ kind: 'error', text: t('logs.status.timeout') });
          break;
        case 'aborted':
          setMessage({ kind: 'status', text: t('logs.status.stopped') });
          break;
        case 'error':
          setMessage({ kind: 'error', text: errorText(outcome.error) });
          break;
      }
    },
    [connectionId, groups, range, region, remember, t],
  );

  const running = phase === 'running';
  const results = run?.results ?? null;
  const failed = message?.kind === 'error';

  // Everything below is derived from the rows in hand. `populationOf` decides what may be said about them.
  const population = useMemo(
    () => populationOf({ fields: results?.fields ?? [], rows: results?.rows ?? [], recordsMatched: results?.statistics.recordsMatched ?? 0 }),
    [results],
  );
  const shown = useMemo(() => {
    const rows = results?.rows ?? [];
    return rows.filter(
      (row) =>
        (facetFilter.level === null || (facetFilter.level === 'none' ? detectLevel(row['@message'] ?? '') === null : detectLevel(row['@message'] ?? '') === facetFilter.level)) &&
        (facetFilter.stream === null || row['@logStream'] === facetFilter.stream),
    );
  }, [results, facetFilter]);
  const buckets = useMemo(() => {
    if (run === null || population === 'aggregated') return [];
    const times = shown.map((row) => rowTimeMs(row['@timestamp'])).filter((value): value is number => value !== null);
    return bucketise(times, { startMs: run.startMs, endMs: run.endMs }, TIMELINE_BUCKETS);
  }, [run, shown, population]);

  const empty = emptyReason({ groups: groups.length, ran: phase === 'done', failed, rows: results?.rows.length ?? 0 });
  const narrowed = facetFilter.level !== null || facetFilter.stream !== null;
  const statusText = message?.kind === 'status' ? message.text : '';

  return (
    <div className="space-y-6">
      {/* The search, first and widest. Everything else on the page is a consequence of it. */}
      <MonitoringCard title={t('logs.search.title')}>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (groups.length > 0 && !running) void search(query);
          }}
        >
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 basis-64 space-y-1">
              <Label htmlFor="logs-text">{t('logs.search.label')}</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  id="logs-text"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  maxLength={SEARCH_TEXT_MAX}
                  placeholder={t('logs.search.placeholder')}
                  className="pr-8 pl-8"
                />
                {text !== '' && (
                  <button
                    type="button"
                    onClick={() => setText('')}
                    aria-label={t('logs.search.clear')}
                    className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="logs-level">{t('logs.facets.level')}</Label>
              <select
                id="logs-level"
                value={level ?? ''}
                onChange={(event) => setLevel(isOneOf(LOG_LEVELS, event.target.value) ? event.target.value : null)}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">{t('logs.search.anyLevel')}</option>
                {LOG_LEVELS.map((value) => (
                  <option key={value} value={value}>
                    {t(`logs.levels.${value}`)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="logs-range">{t('logs.range')}</Label>
              <RangeSelect range={range} groups={groups} />
            </div>

            <div className="space-y-1">
              <Label htmlFor="logs-limit">{t('logs.search.limit')}</Label>
              <select
                id="logs-limit"
                value={limit}
                onChange={(event) => setLimit(Number(event.target.value))}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                {ROW_LIMITS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>

            <Button type="submit" disabled={groups.length === 0 || running} aria-describedby={groups.length === 0 ? RUN_HINT_ID : undefined}>
              {running ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Search className="size-4" aria-hidden />}
              {t('logs.search.run')}
            </Button>
            {running && (
              <Button type="button" variant="outline" onClick={() => controllerRef.current?.abort()}>
                {t('logs.stop')}
              </Button>
            )}
          </div>

          {/* A disabled search always says why, right where it is pressed. */}
          {groups.length === 0 && (
            <p id={RUN_HINT_ID} className="text-sm text-muted-foreground">
              {t('logs.noGroups')}
            </p>
          )}

          {/* What was actually sent to AWS. Not a summary of it — the query itself. */}
          <details open={advanced} onToggle={(event) => setAdvanced((event.currentTarget as HTMLDetailsElement).open)}>
            <summary className="cursor-pointer text-xs text-muted-foreground">{t('logs.search.advanced')}</summary>
            <div className="mt-2 space-y-2">
              <Label htmlFor="logs-query" className="text-xs">
                {t('logs.query')}
              </Label>
              <textarea
                id="logs-query"
                value={advanced ? advancedQuery : query}
                onChange={(event) => setAdvancedQuery(event.target.value)}
                onFocus={() => setAdvancedQuery(query)}
                readOnly={!advanced}
                rows={4}
                maxLength={maxQueryLength}
                spellCheck={false}
                className="w-full rounded-md border bg-transparent p-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              <p className="text-xs text-muted-foreground">{advanced ? t('logs.search.advancedOn') : t('logs.search.advancedOff')}</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_QUERY_KEYS.map((key) => (
                  <Button
                    key={key}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setAdvanced(true);
                      setAdvancedQuery(EXAMPLE_QUERIES[key]);
                    }}
                  >
                    {t(`logs.examples.${key}`)}
                  </Button>
                ))}
              </div>
            </div>
          </details>
        </form>
      </MonitoringCard>

      {/* `min-w-0` on both columns: a grid item defaults to min-content width, and one unbreakable log group
          name in the picker was widening the whole page to 539px inside a 360px viewport. */}
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <div className="min-w-0 space-y-6">
          {groupPicker}
          {results !== null && (
            <MonitoringCard title={t('logs.facets.card')}>
              <LogsFacets
                levels={levelCounts(results.rows)}
                streams={facetOf(results.rows, '@logStream')}
                filter={facetFilter}
                population={population}
                onChange={setFacetFilter}
              />
            </MonitoringCard>
          )}
          <MonitoringCard title={t('logs.saved.title')} description={t('logs.saved.hint')}>
            {/* The search as it stands right now, so saving stores what is on screen rather than what was
                last run. */}
            <SavedSearches
              rows={saved.rows}
              basePath={saved.basePath}
              actions={saved.actions}
              current={{ name: '', text, level, limit, range, logGroups: groups, query: advanced ? advancedQuery : null }}
            />
          </MonitoringCard>
        </div>

        <div className="min-w-0 space-y-6">
          <MonitoringCard title={t('logs.results.label')}>
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                {/*
                 * One live region, never remounted, for both the elapsed time and the outcome. While the query runs it is
                 * visually hidden and the seconds it announces only change every 5 s, so a screen reader is not flooded;
                 * the visible line beside it keeps ticking every second and is hidden from assistive technology.
                 */}
                <p role="status" className={running ? 'sr-only' : undefined}>
                  {running ? t('logs.status.running', { seconds: Math.floor(elapsed / ANNOUNCE_EVERY_MS) * (ANNOUNCE_EVERY_MS / 1000) }) : statusText}
                </p>
                {running && <p aria-hidden="true">{t('logs.status.running', { seconds: Math.round(elapsed / 1000) })}</p>}
              </div>

              {message?.kind === 'error' && (
                <p role="alert" className="text-sm text-destructive">
                  {message.text}
                </p>
              )}

              {results !== null && population !== 'aggregated' && (
                <>
                  <p className="text-sm">
                    {population === 'sample'
                      ? t('logs.results.sample', { shown: results.rows.length, matched: results.statistics.recordsMatched })
                      : t('logs.results.all', { count: results.rows.length })}
                  </p>
                  <LogsTimeline buckets={buckets} population={population} />
                </>
              )}

              {narrowed && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span>{t('logs.facets.narrowed', { shown: shown.length, total: results?.rows.length ?? 0 })}</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => setFacetFilter({ level: null, stream: null })}>
                    {t('logs.facets.clear')}
                  </Button>
                </div>
              )}

              {/* Four different empties, four different sentences. */}
              {empty !== null && !failed && <p className="text-sm text-muted-foreground">{t(`logs.empty.${empty}`)}</p>}

              {results !== null && results.rows.length > 0 && population === 'aggregated' && <Aggregated results={results} />}
              {results !== null && shown.length > 0 && population !== 'aggregated' && <LogsRows rows={shown} fields={results.fields} />}
            </div>
          </MonitoringCard>
        </div>
      </div>
    </div>
  );
}

/** A `stats` query has columns of its own making: it is shown as the table it is, with no log-line dressing. */
function Aggregated({ results }: { results: ClientQueryResults }) {
  const t = useTranslations('Monitoring.client');
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{t('logs.results.aggregated')}</p>
      <Table aria-label={t('logs.results.label')}>
        <TableHeader>
          <TableRow>
            {results.fields.map((field) => (
              <TableHead key={field} className="font-mono text-xs">
                {field}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.rows.map((row, index) => (
            <TableRow key={index}>
              {results.fields.map((field) => (
                <TableCell key={field} className="font-mono text-xs break-all whitespace-pre-wrap">
                  {row[field] ?? ''}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** The range lives in the URL, so the picker's links and the search can never disagree about it. */
function RangeSelect({ range, groups }: { range: LogsTimeRange; groups: string[] }) {
  const t = useTranslations('Monitoring.client');
  const router = useRouter();
  const pathname = usePathname();
  return (
    <select
      id="logs-range"
      value={range}
      onChange={(event) => {
        // Read from the address bar and rewritten from the selection: a tick updates the URL without the router.
        const next = new URLSearchParams(withGroups(window.location.search, groups));
        next.set('range', event.target.value);
        router.replace(`${pathname}?${next.toString()}`);
      }}
      className="h-9 rounded-md border bg-background px-2 text-sm"
    >
      {LOGS_TIME_RANGES.map((value) => (
        <option key={value} value={value}>
          {t(`range.options.${value}`)}
        </option>
      ))}
    </select>
  );
}
