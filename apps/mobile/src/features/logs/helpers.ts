/**
 * Pure helpers for log search: time ranges, level filters, level tones, times, and finding an entry in the React
 * Query cache (the API has no single-entry endpoint).
 */
import type { LogQuery } from '@/api/client';
import type { LogEntry, LogLevel, LogSearch } from '@/api/contract';
import type { MessageKey } from '@/i18n';
import type { IconName } from '@/ui/layout';
import type { Tone } from '@/ui/theme';

export type LogRange = '15m' | '1h' | '6h' | '24h';
export const LOG_RANGES: readonly LogRange[] = ['15m', '1h', '6h', '24h'];
export const DEFAULT_LOG_RANGE: LogRange = '1h';

const MINUTE = 60_000;
const RANGE_MS: Record<LogRange, number> = { '15m': 15 * MINUTE, '1h': 60 * MINUTE, '6h': 6 * 60 * MINUTE, '24h': 24 * 60 * MINUTE };

export function rangeLabelKey(range: LogRange): MessageKey {
  return `logs.range.${range}`;
}

/** `from`/`to` for a range ending at `now`. Computed when the search is submitted, so "last hour" means that hour. */
export function rangeToWindow(range: LogRange, now: number): { from: number; to: number } {
  return { from: now - RANGE_MS[range], to: now };
}

/** Levels offered as filters. `fatal` is folded into `error`, so choosing Error never hides a crash. */
export type LevelFilter = 'error' | 'warn' | 'info' | 'debug';
export const LEVEL_FILTERS: readonly LevelFilter[] = ['error', 'warn', 'info', 'debug'];

/** The levels sent to the server. An empty selection means every level (no filter). */
export function levelsForFilter(selected: readonly LevelFilter[]): LogLevel[] | undefined {
  if (!selected.length) return undefined;
  const out: LogLevel[] = [];
  for (const level of LEVEL_FILTERS) {
    if (!selected.includes(level)) continue;
    out.push(level);
    if (level === 'error') out.push('fatal');
  }
  return out;
}

export type LogSearchForm = { text: string; range: LogRange; levels: readonly LevelFilter[]; service: string | null; source?: string | null };

/** Builds the query sent to `useLogs` from the form state at submit time. */
export function buildLogQuery(form: LogSearchForm, now: number): LogQuery {
  const query: LogQuery = { ...rangeToWindow(form.range, now) };
  const text = form.text.trim();
  if (text) query.text = text;
  const levels = levelsForFilter(form.levels);
  if (levels) query.levels = levels;
  if (form.service) query.service = form.service;
  if (form.source) query.source = form.source;
  return query;
}

const LEVEL_TONES: Record<LogLevel, Tone> = { fatal: 'critical', error: 'critical', warn: 'warning', info: 'info', debug: 'unknown', unknown: 'unknown' };
const LEVEL_ICONS: Record<LogLevel, IconName> = {
  fatal: 'skull-outline',
  error: 'alert-circle',
  warn: 'warning',
  info: 'information-circle',
  debug: 'bug-outline',
  unknown: 'help-circle',
};

export function levelTone(level: LogLevel): Tone {
  return LEVEL_TONES[level];
}

export function levelIcon(level: LogLevel): IconName {
  return LEVEL_ICONS[level];
}

export function levelLabelKey(level: LogLevel): MessageKey {
  return `logs.level.${level}`;
}

function pad(value: number, size = 2): string {
  return String(value).padStart(size, '0');
}

/** HH:MM:SS in the device's time zone, 24-hour, for dense log rows. */
export function formatLogTime(at: number): string {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Full local timestamp with milliseconds, e.g. "2026-09-18 14:03:07.412". */
export function formatLogTimestamp(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${formatLogTime(at)}.${pad(d.getMilliseconds(), 3)}`;
}

function isLogSearchPages(value: unknown): value is { pages: LogSearch[] } {
  return typeof value === 'object' && value !== null && Array.isArray((value as { pages?: unknown }).pages);
}

/**
 * Finds a log entry among cached log searches (`queryClient.getQueriesData({ queryKey: ['logs'] })`). Returns `undefined` when nothing cached has it.
 */
export function findCachedLogEntry(cached: readonly (readonly [unknown, unknown])[], id: string): LogEntry | undefined {
  for (const [, data] of cached) {
    if (!isLogSearchPages(data)) continue;
    for (const page of data.pages) {
      const found = page?.items?.find((item) => item.id === id);
      if (found) return found;
    }
  }
  return undefined;
}

/** Search statistics of the first page, which carries the totals for the whole search. */
export function searchStatistics(pages: readonly LogSearch[] | undefined): LogSearch['statistics'] | undefined {
  return pages?.find((p) => p.statistics)?.statistics;
}

/** The weakest status across pages: a search is only complete when every page is. */
export function searchStatus(pages: readonly LogSearch[] | undefined): LogSearch['status'] | undefined {
  if (!pages?.length) return undefined;
  const order: LogSearch['status'][] = ['failed', 'running', 'partial', 'complete'];
  return pages.reduce<LogSearch['status']>((worst, p) => (order.indexOf(p.status) < order.indexOf(worst) ? p.status : worst), 'complete');
}

/** Example searches shown before the first search. */
export const EXAMPLE_SEARCHES = ['error', 'timeout', 'checkout'] as const;
