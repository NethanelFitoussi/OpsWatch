import { afterEach, describe, expect, it, vi } from 'vitest';
import { pageNow, parseTimeRange, periodForRange, recentWindow, timeWindow } from '@/lib/monitoring/shared/time-range';

const now = Date.parse('2026-09-17T10:07:42.500Z');

afterEach(() => {
  vi.useRealTimers();
});

describe('time ranges', () => {
  it('reads the page clock once, for the whole render', () => {
    vi.useFakeTimers({ now });
    expect(pageNow()).toBe(now);
    expect(timeWindow('1h', pageNow())).toEqual(timeWindow('1h', now));
  });

  it('picks the GetMetricData period from the range', () => {
    expect(['1h', '3h', '12h', '24h', '7d'].map((r) => periodForRange(r as never))).toEqual([60, 60, 300, 300, 3600]);
  });

  it('parses the query string value, defaulting to 3h', () => {
    expect(parseTimeRange('7d')).toBe('7d');
    expect(parseTimeRange(undefined)).toBe('3h');
    expect(parseTimeRange('2h')).toBe('3h');
    expect(parseTimeRange(['12h', '1h'])).toBe('12h');
  });

  it('falls back to the range configured in Settings, which ?range still overrides', () => {
    expect(parseTimeRange(undefined, '24h')).toBe('24h');
    expect(parseTimeRange('2h', '24h')).toBe('24h');
    expect(parseTimeRange('1h', '24h')).toBe('1h');
  });

  it('floors the window end to the minute so cache keys stay stable', () => {
    expect(timeWindow('3h', now)).toEqual({
      start: new Date('2026-09-17T07:07:00.000Z'),
      end: new Date('2026-09-17T10:07:00.000Z'),
      periodSeconds: 60,
    });
    expect(timeWindow('7d', now).periodSeconds).toBe(3600);
    expect(recentWindow(20, now)).toEqual({
      start: new Date('2026-09-17T09:47:00.000Z'),
      end: new Date('2026-09-17T10:07:00.000Z'),
      periodSeconds: 60,
    });
  });
});
