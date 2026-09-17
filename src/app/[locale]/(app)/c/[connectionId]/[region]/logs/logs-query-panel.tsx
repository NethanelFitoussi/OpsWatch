'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { createLogsApi, type ClientQueryResults, type LogsClientError } from '@/lib/monitoring/shared/logs-api';
import { runLogsQuery } from '@/lib/monitoring/shared/logs-poller';
import {
  DEFAULT_LOGS_QUERY,
  EXAMPLE_QUERIES,
  EXAMPLE_QUERY_KEYS,
  LOGS_TIME_RANGES,
  type LogsTimeRange,
} from '@/lib/monitoring/shared/logs-queries';
import { RANGE_SECONDS } from '@/lib/monitoring/shared/time-range';
import { isOneOf } from '@/lib/type-guards';

type Phase = 'idle' | 'running' | 'done';
type Message = { kind: 'status' | 'error'; text: string };

/** Error codes of the Logs routes that have their own message; anything else falls back to the generic one. */
const SIMPLE_ERROR_CODES = ['invalid_query', 'range_too_long', 'unauthorized'] as const;

/** How often the elapsed time reaches the live region, whatever the poll interval is. */
const ANNOUNCE_EVERY_MS = 5000;

/** The query editor: it starts a Logs Insights query, polls it and shows its rows as text. */
export function LogsQueryPanel({
  connectionId,
  region,
  groups,
  initialRange,
  maxQueryLength,
}: {
  connectionId: string;
  region: string;
  groups: string[];
  initialRange: LogsTimeRange;
  maxQueryLength: number;
}) {
  const t = useTranslations('Monitoring.client');
  const [query, setQuery] = useState(DEFAULT_LOGS_QUERY);
  const [range, setRange] = useState<LogsTimeRange>(initialRange);
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [results, setResults] = useState<ClientQueryResults | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
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

  const run = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPhase('running');
    setElapsed(0);
    setResults(null);
    setMessage(null);
    const endSeconds = Math.floor(Date.now() / 1000);
    const outcome = await runLogsQuery({
      api: createLogsApi(connectionId, region),
      input: { logGroups: groups, query, startSeconds: endSeconds - RANGE_SECONDS[range], endSeconds },
      signal: controller.signal,
      onStarted: (queryId) => {
        queryIdRef.current = queryId;
      },
      onProgress: (polled, elapsedMs) => {
        setResults(polled);
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
        setResults(outcome.results);
        setMessage({
          kind: 'status',
          text: t('logs.status.complete', { rows: outcome.results.rows.length, records: outcome.results.statistics.recordsScanned }),
        });
        break;
      case 'ended':
        setResults(outcome.results);
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
  }, [connectionId, groups, query, range, region, t]);

  const running = phase === 'running';
  const fields = results?.fields ?? [];
  const statusText = message?.kind === 'status' ? message.text : '';

  return (
    <div className="space-y-6">
      <MonitoringCard title={t('logs.editor')}>
        <div className="space-y-4">
          <div className="space-y-2">
            <span className="text-sm font-medium">{t('logs.groups')}</span>
            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('logs.noGroups')}</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {groups.map((group) => (
                  <li key={group}>
                    <Badge variant="secondary" className="max-w-full font-mono break-all">
                      {group}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="logs-query">{t('logs.query')}</Label>
            <textarea
              id="logs-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              rows={6}
              maxLength={maxQueryLength}
              spellCheck={false}
              className="w-full rounded-md border bg-transparent p-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="logs-range">{t('logs.range')}</Label>
              <select
                id="logs-range"
                value={range}
                onChange={(event) => setRange(event.target.value as LogsTimeRange)}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                {LOGS_TIME_RANGES.map((value) => (
                  <option key={value} value={value}>
                    {t(`range.options.${value}`)}
                  </option>
                ))}
              </select>
            </div>
            <Button type="button" onClick={() => void run()} disabled={groups.length === 0 || running}>
              {t('logs.run')}
            </Button>
            {running && (
              <Button type="button" variant="outline" onClick={() => controllerRef.current?.abort()}>
                {t('logs.stop')}
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium">{t('logs.examples.label')}</span>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_QUERY_KEYS.map((key) => (
                <Button key={key} type="button" variant="outline" size="sm" onClick={() => setQuery(EXAMPLE_QUERIES[key])}>
                  {t(`logs.examples.${key}`)}
                </Button>
              ))}
            </div>
          </div>

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
        </div>
      </MonitoringCard>

      {/* Rows show as they arrive; "no rows" only once the query has ended. Every cell is text, never markup. */}
      {results !== null && (results.rows.length > 0 || phase === 'done') && (
        <MonitoringCard title={t('logs.results.label')}>
          {results.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('logs.results.empty')}</p>
          ) : (
            <Table aria-label={t('logs.results.label')}>
              <TableHeader>
                <TableRow>
                  {fields.map((field) => (
                    <TableHead key={field} className="font-mono text-xs">
                      {field}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.rows.map((row, index) => (
                  // Logs Insights rows have no stable id once @ptr is dropped, and the list is replaced wholesale.
                  <TableRow key={index}>
                    {fields.map((field) => (
                      <TableCell key={field} className="font-mono text-xs break-all whitespace-pre-wrap">
                        {row[field] ?? ''}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </MonitoringCard>
      )}
    </div>
  );
}
