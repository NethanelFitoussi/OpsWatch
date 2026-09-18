import type { LogEntry, LogSearch } from '@/api/contract';
import { translate } from '@/i18n';
import {
  buildLogQuery,
  findCachedLogEntry,
  formatLogTime,
  levelLabelKey,
  levelsForFilter,
  levelTone,
  rangeToWindow,
  searchStatistics,
  searchStatus,
} from '../helpers';

const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);

describe('time ranges', () => {
  it('computes from/to ending now', () => {
    expect(rangeToWindow('15m', NOW)).toEqual({ from: NOW - 15 * 60_000, to: NOW });
    expect(rangeToWindow('1h', NOW)).toEqual({ from: NOW - 3_600_000, to: NOW });
    expect(rangeToWindow('6h', NOW)).toEqual({ from: NOW - 6 * 3_600_000, to: NOW });
    expect(rangeToWindow('24h', NOW)).toEqual({ from: NOW - 86_400_000, to: NOW });
  });
});

describe('level filters', () => {
  it('means "every level" when nothing is selected', () => {
    expect(levelsForFilter([])).toBeUndefined();
  });

  it('includes fatal with error, in a stable order', () => {
    expect(levelsForFilter(['warn', 'error'])).toEqual(['error', 'fatal', 'warn']);
    expect(levelsForFilter(['debug'])).toEqual(['debug']);
  });

  it('maps levels to tones and words', () => {
    expect(levelTone('error')).toBe('critical');
    expect(levelTone('fatal')).toBe('critical');
    expect(levelTone('warn')).toBe('warning');
    expect(levelTone('info')).toBe('info');
    expect(levelTone('debug')).toBe('unknown');
    expect(levelTone('unknown')).toBe('unknown');
    expect(translate('en', levelLabelKey('warn'))).toBe('Warning');
  });
});

describe('buildLogQuery', () => {
  it('builds a query with only the filters that are set', () => {
    expect(buildLogQuery({ text: '  ', range: '1h', levels: [], service: null }, NOW)).toEqual({ from: NOW - 3_600_000, to: NOW });
    expect(buildLogQuery({ text: ' TypeError ', range: '15m', levels: ['error'], service: 'checkout-api', source: '/ecs/checkout-api' }, NOW)).toEqual({
      from: NOW - 15 * 60_000,
      to: NOW,
      text: 'TypeError',
      levels: ['error', 'fatal'],
      service: 'checkout-api',
      source: '/ecs/checkout-api',
    });
  });
});

describe('formatLogTime', () => {
  it('renders HH:MM:SS with leading zeros', () => {
    const at = new Date(2026, 8, 18, 7, 5, 9).getTime();
    expect(formatLogTime(at)).toBe('07:05:09');
  });
});

const entry = (id: string): LogEntry => ({ id, timestamp: NOW, level: 'info', message: id });
const page = (items: LogEntry[], extra: Partial<LogSearch> = {}): LogSearch => ({ searchId: 's', status: 'complete', items, nextCursor: null, ...extra });

describe('findCachedLogEntry', () => {
  it('finds an entry in any page of any cached search', () => {
    const cached = [
      [['logs', 'list', null, { from: 1, to: 2 }], { pages: [page([entry('a')]), page([entry('b')])], pageParams: [null, 'c1'] }],
      [['logs', 'list', null, { from: 3, to: 4 }], { pages: [page([entry('c')])], pageParams: [null] }],
    ] as const;
    expect(findCachedLogEntry(cached, 'b')?.id).toBe('b');
    expect(findCachedLogEntry(cached, 'c')?.id).toBe('c');
  });

  it('returns undefined when nothing is cached or the shape is unexpected', () => {
    expect(findCachedLogEntry([], 'a')).toBeUndefined();
    expect(findCachedLogEntry([[['logs'], undefined], [['logs'], { foo: 1 }]], 'a')).toBeUndefined();
  });
});

describe('search summary', () => {
  it('reads statistics and the weakest status across pages', () => {
    const pages = [page([], { statistics: { recordsMatched: 3, recordsScanned: 240 } }), page([], { status: 'partial' })];
    expect(searchStatistics(pages)).toEqual({ recordsMatched: 3, recordsScanned: 240 });
    expect(searchStatus(pages)).toBe('partial');
    expect(searchStatus([page([])])).toBe('complete');
    expect(searchStatus(undefined)).toBeUndefined();
  });
});
