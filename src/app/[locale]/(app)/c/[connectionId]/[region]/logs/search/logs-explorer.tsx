'use client';

import { ChevronDown, Code2, Loader2, Search, Sparkles, Star, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DocLink } from '@/components/docs/doc-link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { usePathname, useRouter } from '@/i18n/navigation';
import type { FormAction } from '@/lib/forms/action-state';
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
import type { ProposeState } from './actions';
import { AiAssist } from './ai-assist';
import { LogsFacets, type FacetFilter } from './logs-facets';
import { LogsRows } from './logs-rows';
import { LogsTimeline } from './logs-timeline';
import { QuickSearches, type QuickSearch } from './quick-searches';
import { SavedSearches, type SavedRow, type SavedSearchActions } from './saved-searches';
import { SourcePicker, type PickerGroup } from './source-picker';
import { useLogsSelection } from './logs-selection';

/**
 * The Logs explorer.
 *
 * Arranged around the thing somebody came to do. One row of controls — **search, time, level, sources,
 * go** — then the timeline, then the log lines, with the facets tucked beside them. Everything that is
 * configuration rather than searching is behind a disclosure: the Logs Insights query, the AI helper,
 * the saved searches.
 *
 * What it replaced: a permanent left column of log-group checkboxes beside a raw query textarea, with
 * the results, when there were any, below the fold. That is a configuration form. This is meant to be an
 * explorer, and the difference is what gets the vertical space.
 *
 * The empty state is the other half of that. A blank page teaches nobody what they can ask, so before a
 * search it offers the four questions people actually arrive with, the searches they saved, and — only
 * when a provider is configured — the assistant.
 *
 * Nothing about the honesty changed. Four distinct empties, a sample never presented as a total, a level
 * never invented, and the query always visible.
 */

const SIMPLE_ERROR_CODES = ['invalid_query', 'range_too_long', 'unauthorized'] as const;
const ANNOUNCE_EVERY_MS = 5000;
const TIMELINE_BUCKETS = 40;
const RUN_HINT_ID = 'logs-run-hint';

type Phase = 'idle' | 'running' | 'done';
type Message = { kind: 'status' | 'error'; text: string };
type Run = { results: ClientQueryResults; startMs: number; endMs: number; query: string };

export function LogsExplorer({
  connectionId,
  region,
  range,
  maxQueryLength,
  initial,
  sources,
  saved,
  propose,
}: {
  connectionId: string;
  region: string;
  range: LogsTimeRange;
  maxQueryLength: number;
  initial: { text: string; level: LogLevel | null; limit: number };
  /** The log groups this region has, already fetched and formatted on the server. */
  sources: { groups: PickerGroup[]; truncated: boolean; failed: boolean; search: string };
  saved: { rows: SavedRow[]; basePath: string; actions: SavedSearchActions };
  propose: FormAction<ProposeState> | null;
}) {
  const t = useTranslations('Monitoring.client');
  const { selected: groups } = useLogsSelection();
  const router = useRouter();
  const pathname = usePathname();

  const [text, setText] = useState(initial.text);
  const [level, setLevel] = useState<LogLevel | null>(initial.level);
  const [limit, setLimit] = useState(initial.limit);
  const [advanced, setAdvanced] = useState(false);
  const [advancedQuery, setAdvancedQuery] = useState(() => buildSearchQuery({ text: initial.text, level: initial.level, limit: initial.limit }));
  // `null` means nobody has expressed a preference, so the panel follows the page: open while there is
  // nothing to read, out of the way once there is. A saved search is most useful before a search.
  const [savedPreference, setSavedPreference] = useState<boolean | null>(null);
  const [showAi, setShowAi] = useState(false);

  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [run, setRun] = useState<Run | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [facetFilter, setFacetFilter] = useState<FacetFilter>({ level: null, stream: null });
  const controllerRef = useRef<AbortController | null>(null);
  const queryIdRef = useRef<string | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => {
    const onPageHide = () => {
      const queryId = queryIdRef.current;
      if (queryId) void createLogsApi(connectionId, region).stop(queryId).catch(() => undefined);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [connectionId, region]);

  const query = advanced ? advancedQuery : buildSearchQuery({ text, level, limit });

  const remember = useCallback(
    (over: { text?: string; level?: LogLevel | null; limit?: number } = {}) => {
      const params = new URLSearchParams(withGroups(window.location.search, groups));
      const nextText = (over.text ?? text).trim();
      const nextLevel = over.level === undefined ? level : over.level;
      if (nextText === '') params.delete('q');
      else params.set('q', nextText.slice(0, SEARCH_TEXT_MAX));
      if (nextLevel === null) params.delete('level');
      else params.set('level', nextLevel);
      params.set('limit', String(over.limit ?? limit));
      window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}${window.location.hash}`);
    },
    [groups, level, limit, text],
  );

  const search = useCallback(
    async (searchQuery: string, over: { text?: string; level?: LogLevel | null } = {}) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setPhase('running');
      setElapsed(0);
      setRun(null);
      setMessage(null);
      setFacetFilter({ level: null, stream: null });
      remember(over);

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
          setMessage({ kind: 'status', text: t('logs.status.complete', { records: outcome.results.statistics.recordsScanned }) });
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

  /** A quick search sets the controls and runs, so one press is one answer. */
  const runQuick = (quick: QuickSearch) => {
    setText(quick.text);
    setLevel(quick.level);
    void search(buildSearchQuery({ text: quick.text, level: quick.level, limit }), { text: quick.text, level: quick.level });
  };

  const useProposal = (proposal: NonNullable<ProposeState['proposal']>) => {
    const next = new URLSearchParams(withGroups(window.location.search, proposal.groups));
    if (proposal.text === '') next.delete('q');
    else next.set('q', proposal.text);
    if (proposal.level === null) next.delete('level');
    else next.set('level', proposal.level);
    next.set('limit', String(proposal.limit));
    next.set('range', proposal.range);
    router.replace(`${pathname}?${next.toString()}`);
  };

  const changeRange = (value: string) => {
    const next = new URLSearchParams(withGroups(window.location.search, groups));
    next.set('range', value);
    router.replace(`${pathname}?${next.toString()}`);
  };

  const running = phase === 'running';
  const showSaved = savedPreference ?? phase === 'idle';
  const results = run?.results ?? null;
  const failed = message?.kind === 'error';

  const population = useMemo(
    () => populationOf({ fields: results?.fields ?? [], rows: results?.rows ?? [], recordsMatched: results?.statistics.recordsMatched ?? 0 }),
    [results],
  );
  const shown = useMemo(() => {
    const rows = results?.rows ?? [];
    return rows.filter(
      (row) =>
        (facetFilter.level === null ||
          (facetFilter.level === 'none' ? detectLevel(row['@message'] ?? '') === null : detectLevel(row['@message'] ?? '') === facetFilter.level)) &&
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
  const hasResults = results !== null && results.rows.length > 0;

  // Announced at a human pace. The visible counter ticks every poll; reading that out would talk over
  // itself, so the live region rounds the elapsed time into five-second steps.
  const announced = running
    ? t('logs.status.running', { seconds: Math.floor(elapsed / ANNOUNCE_EVERY_MS) * (ANNOUNCE_EVERY_MS / 1000) })
    : (message?.text ?? '');

  return (
    <div className="space-y-4">
      <p role="status" aria-live="polite" className="sr-only">
        {announced}
      </p>
      {/* One row of controls. Everything else is a disclosure. */}
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (groups.length > 0 && !running) void search(query);
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-80">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="logs-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={SEARCH_TEXT_MAX}
              placeholder={t('logs.search.placeholder')}
              aria-label={t('logs.search.label')}
              className="h-11 pr-9 pl-9 text-base"
            />
            {text !== '' && (
              <button
                type="button"
                onClick={() => setText('')}
                aria-label={t('logs.search.clear')}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" aria-hidden />
              </button>
            )}
          </div>

          <select
            value={range}
            onChange={(event) => changeRange(event.target.value)}
            aria-label={t('logs.range')}
            className="h-11 rounded-md border bg-background px-3 text-sm"
          >
            {LOGS_TIME_RANGES.map((value) => (
              <option key={value} value={value}>
                {t(`range.options.${value}`)}
              </option>
            ))}
          </select>

          <select
            value={level ?? ''}
            onChange={(event) => setLevel(isOneOf(LOG_LEVELS, event.target.value) ? event.target.value : null)}
            aria-label={t('logs.facets.level')}
            className="h-11 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">{t('logs.search.anyLevel')}</option>
            {LOG_LEVELS.map((value) => (
              <option key={value} value={value}>
                {t(`logs.levels.${value}`)}
              </option>
            ))}
          </select>

          {/* The source selector: one control, not a column. */}
          <div className="min-w-48">
            <SourcePicker groups={sources.groups} truncated={sources.truncated} search={sources.search} />
          </div>

          <Button type="submit" size="lg" className="h-11" disabled={groups.length === 0 || running} aria-describedby={groups.length === 0 ? RUN_HINT_ID : undefined}>
            {running ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Search className="size-4" aria-hidden />}
            {t('logs.search.run')}
          </Button>
          {running && (
            <Button type="button" variant="outline" className="h-11" onClick={() => controllerRef.current?.abort()}>
              {t('logs.stop')}
            </Button>
          )}
        </div>

        {/* Nothing to search yet: said once, next to the control that fixes it. */}
        {groups.length === 0 && (
          <p id={RUN_HINT_ID} className="text-sm text-muted-foreground">
            {sources.failed ? t('logs.sources.failed') : t('logs.noGroups')}
          </p>
        )}

        {/* The secondary entry points, beside the search rather than buried under it. */}
        <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-sm">
          <select
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
            aria-label={t('logs.search.limit')}
            className="h-8 rounded-md border bg-background px-2 text-xs"
          >
            {ROW_LIMITS.map((value) => (
              <option key={value} value={value}>
                {t('logs.search.lines', { count: value })}
              </option>
            ))}
          </select>

          {propose !== null && (
            <button
              type="button"
              onClick={() => setShowAi((value) => !value)}
              aria-expanded={showAi}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/30 px-2.5 text-xs text-primary transition-colors hover:bg-primary/10"
            >
              <Sparkles className="size-3.5" aria-hidden /> {t('logs.ai.open')}
            </button>
          )}

          <button
            type="button"
            onClick={() => setSavedPreference(!showSaved)}
            aria-expanded={showSaved}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors hover:bg-muted"
          >
            <Star className="size-3.5 text-muted-foreground" aria-hidden /> {t('logs.saved.open', { count: saved.rows.length })}
            <ChevronDown className={`size-3 transition-transform ${showSaved ? 'rotate-180' : ''}`} aria-hidden />
          </button>

          <details
            open={advanced}
            onToggle={(event) => {
              const open = (event.currentTarget as HTMLDetailsElement).open;
              // Opening it hands over the query the simple controls had built, so the advanced view starts
              // from what was about to run rather than from whatever it held last.
              if (open) setAdvancedQuery(buildSearchQuery({ text, level, limit }));
              setAdvanced(open);
            }}
            className="min-w-0"
          >
            <summary className="inline-flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted">
              <Code2 className="size-3.5" aria-hidden /> {t('logs.search.advanced')}
              <ChevronDown className={`size-3 transition-transform ${advanced ? 'rotate-180' : ''}`} aria-hidden />
            </summary>
          </details>

          {/* What will actually run, on one line, without opening anything. */}
          {!advanced && <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={query}>{query}</span>}
        </div>

        {advanced && (
          <div className="space-y-2 rounded-lg border p-3">
            <Label htmlFor="logs-query" className="text-xs">
              {t('logs.query')}
            </Label>
            <textarea
              id="logs-query"
              value={advancedQuery}
              onChange={(event) => setAdvancedQuery(event.target.value)}
              rows={3}
              maxLength={maxQueryLength}
              spellCheck={false}
              className="w-full rounded-md border bg-transparent p-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <p className="text-xs text-muted-foreground">{t('logs.search.advancedOn')}</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_QUERY_KEYS.map((key) => (
                <Button key={key} type="button" variant="outline" size="sm" onClick={() => setAdvancedQuery(EXAMPLE_QUERIES[key])}>
                  {t(`logs.examples.${key}`)}
                </Button>
              ))}
            </div>
          </div>
        )}

        {propose !== null && showAi && <AiAssist groups={groups} propose={propose} onUse={useProposal} />}
      </form>

      {/* Before a search: the questions people arrive with, rather than a void. */}
      {phase === 'idle' && !hasResults && (
        <div className="space-y-4 rounded-lg border border-dashed p-6">
          <div>
            <h2 className="text-base font-medium">{t('logs.start.title')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('logs.start.hint')}</p>
          </div>
          <QuickSearches onPick={runQuick} />
          {empty !== null && <p className="text-sm text-muted-foreground">{t(`logs.empty.${empty}`)}</p>}
          <p className="text-xs text-muted-foreground">
            {t('logs.search.billed')} <DocLink slug="searching-logs" label={t('logs.search.readGuide')} />
          </p>
        </div>
      )}

      {showSaved && (
        <div className="rounded-lg border p-3">
          <SavedSearches
            rows={saved.rows}
            basePath={saved.basePath}
            actions={saved.actions}
            current={{ name: '', text, level, limit, range, logGroups: groups, query: advanced ? advancedQuery : null }}
          />
        </div>
      )}

      {/* How much came back, and the timeline of it — above the lines, the full width of them. */}
      {results !== null && population !== 'aggregated' && (
        <div className="rounded-lg border p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium">
              {/* A sample is never printed as a total: the two sentences are different sentences. */}
              {population === 'sample'
                ? t('logs.results.sample', { shown: results.rows.length, matched: results.statistics.recordsMatched })
                : t('logs.results.all', { count: results.rows.length })}
            </p>
            <p className="text-xs text-muted-foreground">{running ? t('logs.status.running', { seconds: Math.round(elapsed / 1000) }) : statusText}</p>
          </div>
          {buckets.length > 0 && <LogsTimeline buckets={buckets} population={population} />}
        </div>
      )}

      {message?.kind === 'error' && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {message.text}
        </p>
      )}

      {/* Facets beside the logs on a wide screen; under them on a narrow one, because in one column the
          log lines are what the page is for and they go first. */}
      {(hasResults || (phase === 'done' && empty !== null)) && (
        <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
          <div className="min-w-0 space-y-3 lg:order-2">
            {narrowed && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span>{t('logs.facets.narrowed', { shown: shown.length, total: results?.rows.length ?? 0 })}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => setFacetFilter({ level: null, stream: null })}>
                  {t('logs.facets.clear')}
                </Button>
              </div>
            )}
            {empty !== null && !failed && <p className="rounded-lg border p-4 text-sm text-muted-foreground">{t(`logs.empty.${empty}`)}</p>}
            {results !== null && results.rows.length > 0 && population === 'aggregated' && <Aggregated results={results} />}
            {results !== null && shown.length > 0 && population !== 'aggregated' && <LogsRows rows={shown} fields={results.fields} />}
          </div>

          <div className="min-w-0 lg:order-1">
            {results !== null && population !== 'aggregated' && (
              <details open className="rounded-lg border p-3 lg:sticky lg:top-4">
                <summary className="cursor-pointer text-sm font-medium">{t('logs.facets.card')}</summary>
                <div className="mt-3">
                  <LogsFacets
                    levels={levelCounts(results.rows)}
                    streams={facetOf(results.rows, '@logStream')}
                    filter={facetFilter}
                    population={population}
                    onChange={setFacetFilter}
                  />
                </div>
              </details>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** A `stats` query has columns of its own making: it is shown as the table it is. */
function Aggregated({ results }: { results: ClientQueryResults }): ReactNode {
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
