import { describe, expect, it } from 'vitest';
import {
  ENDPOINTS_MAX_WINDOW_MS,
  ENDPOINTS_ROW_LIMIT,
  SAMPLE_LINES,
  clampWindow,
  endpointsQuery,
  isSafeField,
  parseEndpointRows,
  sampleQuery,
} from '@/lib/monitoring/endpoints';

const mapping = { routeField: 'route', durationField: 'duration_ms' };

describe('the query §3b describes', () => {
  it('groups the duration statistics by route and sorts by p95', () => {
    const query = endpointsQuery(mapping) ?? '';
    expect(query).toContain('stats count(*) as hits');
    expect(query).toContain('pct(duration_ms, 95) as p95Ms');
    expect(query).toContain('by route as route');
    expect(query).toContain('sort p95Ms desc');
    expect(query).toContain(`limit ${ENDPOINTS_ROW_LIMIT}`);
  });

  it('requires both fields to be present, so a line missing one does not distort an average', () => {
    expect(endpointsQuery(mapping)).toContain('filter ispresent(route) and ispresent(duration_ms)');
  });

  it('limits to fifty rows, because a page is a summary and not a data export', () => {
    expect(ENDPOINTS_ROW_LIMIT).toBe(50);
  });
});

describe('a field name comes from an operator, so it is not trusted', () => {
  /**
   * Logs Insights has no parameter binding. The only defence against a field name that closes the query and
   * appends its own is refusing the name, so that is what happens.
   */
  it('THE RULING: a field that could break out of the query is refused, not escaped', () => {
    const hostile = [
      'route | delete @message',
      'route\n| stats count(*)',
      'route)',
      "route'",
      'route; drop',
      '',
      'a'.repeat(200),
    ];
    for (const field of hostile) {
      expect(isSafeField(field), field).toBe(false);
      expect(endpointsQuery({ routeField: field, durationField: 'd' }), field).toBeNull();
      expect(endpointsQuery({ routeField: 'route', durationField: field }), field).toBeNull();
    }
  });

  it('accepts the field names real logs use', () => {
    for (const field of ['route', 'path', 'duration_ms', '@message', 'http.target', 'req-id', 'a']) {
      expect(isSafeField(field), field).toBe(true);
    }
    expect(endpointsQuery({ routeField: 'http.target', durationField: 'duration' })).toContain('http.target');
  });
});

describe('reading the rows back', () => {
  it('parses the four statistics', () => {
    expect(parseEndpointRows([{ route: '/checkout', hits: '1200', avgMs: '84.5', p95Ms: '410', maxMs: '2100' }])).toEqual([
      { route: '/checkout', count: 1200, averageMs: 84.5, p95Ms: 410, maxMs: 2100 },
    ]);
  });

  it('THE RULING: a statistic the query did not return is null, never 0', () => {
    const [row] = parseEndpointRows([{ route: '/a', hits: '5' }]);
    // 0 ms would be a latency nobody measured, and would sort to the top of a "fastest" view.
    expect(row).toMatchObject({ count: 5, averageMs: null, p95Ms: null, maxMs: null });
  });

  it('drops a row with no route, which is not a row about an endpoint', () => {
    expect(parseEndpointRows([{ hits: '5', p95Ms: '10' }, { route: '', hits: '1' }])).toEqual([]);
  });

  it('ignores a value that is not a number rather than reading it as zero', () => {
    const [row] = parseEndpointRows([{ route: '/a', hits: '2', p95Ms: 'n/a' }]);
    expect(row?.p95Ms).toBeNull();
  });
});

describe('the window is bounded, like the rest of the Logs section', () => {
  const now = Date.UTC(2026, 8, 22, 12, 0, 0);

  it('leaves a window inside the limit alone', () => {
    const asked = { fromMs: now - 3 * 60 * 60_000, toMs: now };
    expect(clampWindow(asked.fromMs, asked.toMs)).toEqual({ ...asked, clamped: false });
  });

  it('THE RULING: a longer window is cut to a day and says it was', () => {
    const clamped = clampWindow(now - 7 * 24 * 60 * 60_000, now);
    expect(clamped.clamped).toBe(true);
    expect(clamped.toMs - clamped.fromMs).toBe(ENDPOINTS_MAX_WINDOW_MS);
    // Cut from the near end, so the window still ends now rather than a week ago.
    expect(clamped.toMs).toBe(now);
  });

  it('allows exactly a day', () => {
    expect(clampWindow(now - ENDPOINTS_MAX_WINDOW_MS, now).clamped).toBe(false);
  });
});

describe('when the mapping matches nothing', () => {
  it('asks for raw lines, so the operator can read the real field names instead of guessing', () => {
    const query = sampleQuery();
    expect(query).toContain('fields @message');
    expect(query).toContain(`limit ${SAMPLE_LINES}`);
    // Deliberately a handful: this is a diagnostic, not a log viewer, and every scan is billed.
    expect(SAMPLE_LINES).toBeLessThanOrEqual(5);
  });
});
