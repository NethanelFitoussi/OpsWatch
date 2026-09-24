import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROW_LIMIT,
  LOG_LEVELS,
  SEARCH_TEXT_MAX,
  bucketise,
  buildSearchQuery,
  detectLevel,
  emptyReason,
  escapeRegexLiteral,
  facetOf,
  hasSearchText,
  levelCounts,
  populationOf,
  rowTimeMs,
} from '@/lib/monitoring/shared/logs-search';

describe('building the query a search runs', () => {
  it('searches the message case-insensitively, because a search box is expected to', () => {
    expect(buildSearchQuery({ text: 'timeout', level: null, limit: 100 })).toBe(
      'fields @timestamp, @logStream, @message | filter @message like /(?i)timeout/ | sort @timestamp desc | limit 100',
    );
  });

  it('omits the filter entirely when nothing was typed, rather than filtering on an empty pattern', () => {
    expect(buildSearchQuery({ text: '   ', level: null, limit: 100 })).toBe(
      'fields @timestamp, @logStream, @message | sort @timestamp desc | limit 100',
    );
  });

  it('adds a level as a second filter, so text and level narrow together', () => {
    const query = buildSearchQuery({ text: 'charge', level: 'error', limit: 500 });
    expect(query).toContain('filter @message like /(?i)charge/');
    expect(query).toContain('fatal');
    expect(query).toContain('limit 500');
  });

  it('THE RULING: typed text can never close the regex and continue the query', () => {
    // `/ | fields @message | limit 1` would otherwise end the literal and append a command nobody asked for.
    const query = buildSearchQuery({ text: '/ | stats count(*)', level: null, limit: 100 });
    // Exactly one `sort` and one `limit`: the text did not become part of the pipeline.
    expect(query.split('|').filter((part) => part.trim().startsWith('sort'))).toHaveLength(1);
    expect(query).toContain('\\/');
    expect(query).not.toContain('stats count(*) |');
  });

  it('escapes every regex metacharacter, so a search for a path finds that path', () => {
    expect(escapeRegexLiteral('GET /v1/users?id=1.2')).toBe('GET \\/v1\\/users\\?id=1\\.2');
    expect(escapeRegexLiteral('a+b*c(d)[e]{f}^g$h|i')).toBe('a\\+b\\*c\\(d\\)\\[e\\]\\{f\\}\\^g\\$h\\|i');
  });

  it('bounds the text, because a search term is not an essay', () => {
    const query = buildSearchQuery({ text: 'x'.repeat(1000), level: null, limit: DEFAULT_ROW_LIMIT });
    expect(query).toContain('x'.repeat(SEARCH_TEXT_MAX));
    expect(query).not.toContain('x'.repeat(SEARCH_TEXT_MAX + 1));
  });

  it('knows whitespace is not a search term', () => {
    expect(hasSearchText(' \t ')).toBe(false);
    expect(hasSearchText(' a ')).toBe(true);
  });
});

describe('the level a line announces', () => {
  it('reads the word the logger wrote', () => {
    expect(detectLevel('2026-09-24 ERROR could not connect')).toBe('error');
    expect(detectLevel('level=warn retrying')).toBe('warn');
    expect(detectLevel('INFO started')).toBe('info');
    expect(detectLevel('[debug] cache miss')).toBe('debug');
  });

  it('THE RULING: a line with no level has none, rather than being called info', () => {
    expect(detectLevel('GET /health 200 3ms')).toBeNull();
  });

  it('does not find a level inside a longer word', () => {
    expect(detectLevel('terror management failed')).toBeNull();
    expect(detectLevel('informative message')).toBeNull();
  });

  it('calls a line that says both what the worse of the two is', () => {
    expect(detectLevel('ERROR: will retry, warning issued')).toBe('error');
  });
});

describe('reading a row’s timestamp', () => {
  it('THE RULING: Logs Insights states @timestamp in UTC, and it is read as UTC', () => {
    // Parsed as local time this slides by the browser's offset, and every bar of the timeline with it.
    expect(rowTimeMs('2026-09-24 12:00:00.000')).toBe(Date.UTC(2026, 8, 24, 12, 0, 0, 0));
  });

  it('accepts the shapes AWS sends and refuses the rest', () => {
    expect(rowTimeMs('2026-09-24T12:00:00.500')).toBe(Date.UTC(2026, 8, 24, 12, 0, 0, 500));
    expect(rowTimeMs('2026-09-24 12:00:00')).toBe(Date.UTC(2026, 8, 24, 12, 0, 0, 0));
    expect(rowTimeMs('yesterday')).toBeNull();
    expect(rowTimeMs(undefined)).toBeNull();
  });
});

describe('the timeline', () => {
  const window = { startMs: 0, endMs: 1000 };

  it('spreads events over equal buckets', () => {
    const buckets = bucketise([10, 20, 600], window, 2);
    expect(buckets.map((bucket) => bucket.count)).toEqual([2, 1]);
  });

  it('THE RULING: an event outside the window is dropped, not piled onto the nearest bar', () => {
    expect(bucketise([-5, 5000], window, 4).map((bucket) => bucket.count)).toEqual([0, 0, 0, 0]);
  });

  it('gives the newest event to the last bucket rather than losing it off the end', () => {
    expect(bucketise([1000], window, 4)[3].count).toBe(1);
  });

  it('has no buckets for a window with no width', () => {
    expect(bucketise([1], { startMs: 5, endMs: 5 }, 10)).toEqual([]);
  });
});

describe('what the rows on screen are', () => {
  const rows = [{ '@timestamp': 'x' }, { '@timestamp': 'y' }];

  it('THE RULING: rows cut short by the limit are a sample, and never a total', () => {
    expect(populationOf({ fields: ['@timestamp'], rows, recordsMatched: 900 })).toBe('sample');
    expect(populationOf({ fields: ['@timestamp'], rows, recordsMatched: 2 })).toBe('complete');
  });

  it('calls a stats query what it is, because it has no records to list', () => {
    expect(populationOf({ fields: ['service', 'count'], rows, recordsMatched: 50_000 })).toBe('aggregated');
  });
});

describe('facets', () => {
  const rows = [
    { '@logStream': 'a', '@message': 'ERROR one' },
    { '@logStream': 'a', '@message': 'ERROR two' },
    { '@logStream': 'b', '@message': 'GET /health' },
  ];

  it('counts values, most frequent first', () => {
    expect(facetOf(rows, '@logStream')).toEqual([
      { value: 'a', count: 2 },
      { value: 'b', count: 1 },
    ]);
  });

  it('THE RULING: a row with no value for the field is left out, not counted under a blank label', () => {
    expect(facetOf([...rows, { '@message': 'x' }, { '@logStream': '', '@message': 'y' }], '@logStream')).toEqual([
      { value: 'a', count: 2 },
      { value: 'b', count: 1 },
    ]);
  });

  it('counts lines with no level as their own group', () => {
    expect(levelCounts(rows)).toEqual([
      { level: 'error', count: 2 },
      { level: null, count: 1 },
    ]);
  });

  it('offers every level it can recognise', () => {
    expect(LOG_LEVELS).toEqual(['error', 'warn', 'info', 'debug']);
  });
});

describe('THE RULING: an empty screen says which kind of empty it is', () => {
  it('separates the four', () => {
    expect(emptyReason({ groups: 0, ran: false, failed: false, rows: 0 })).toBe('no_groups');
    expect(emptyReason({ groups: 2, ran: false, failed: false, rows: 0 })).toBe('not_run');
    expect(emptyReason({ groups: 2, ran: true, failed: true, rows: 0 })).toBe('failed');
    expect(emptyReason({ groups: 2, ran: true, failed: false, rows: 0 })).toBe('no_match');
  });

  it('is null when there is something to show', () => {
    expect(emptyReason({ groups: 2, ran: true, failed: false, rows: 3 })).toBeNull();
  });

  it('never calls a failed search "nothing matched"', () => {
    expect(emptyReason({ groups: 2, ran: true, failed: true, rows: 0 })).not.toBe('no_match');
  });
});

describe('the shapes a @timestamp really arrives in', () => {
  it('reads epoch milliseconds, which is what some clients send instead of the formatted string', () => {
    expect(rowTimeMs('1790252648794')).toBe(1_790_252_648_794);
  });

  it('THE RULING: a short number is an identifier, not a date in 1973', () => {
    // Read as epoch milliseconds, `12345` would put a bar at the left edge of every timeline.
    expect(rowTimeMs('12345')).toBeNull();
    expect(rowTimeMs('42')).toBeNull();
  });
});

describe('an empty result is not an aggregation', () => {
  it('THE RULING: no rows and no fields is an empty search, not a stats query', () => {
    // A query that matched nothing names no fields either, and calling that "aggregated" hides the
    // sentence that says the search ran and found nothing.
    expect(populationOf({ fields: [], rows: [], recordsMatched: 0 })).toBe('complete');
  });
});
