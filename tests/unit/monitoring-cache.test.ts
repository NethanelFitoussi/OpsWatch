import { describe, expect, it, vi } from 'vitest';
import { cacheKey, cached, createTtlCache } from '@/lib/monitoring/cache';
import type { MonitoringResult } from '@/lib/monitoring/result';

const scope = { connectionId: 'abc123def456', region: 'eu-west-1' };

function clock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('TTL cache', () => {
  it('reuses a successful result for its TTL, counted from when it resolved', async () => {
    const c = clock();
    const cache = createTtlCache({ now: c.now });
    const load = vi.fn(async (): Promise<MonitoringResult<number>> => ({ ok: true, data: 1 }));
    await cached(cache, 'k', 60_000, load);
    c.advance(59_999);
    await cached(cache, 'k', 60_000, load);
    expect(load).toHaveBeenCalledTimes(1);
    c.advance(1);
    await cached(cache, 'k', 60_000, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares a pending load between concurrent callers', async () => {
    const cache = createTtlCache();
    const load = vi.fn(async (): Promise<MonitoringResult<string>> => ({ ok: true, data: 'x' }));
    const [a, b] = await Promise.all([cached(cache, 'k', 1000, load), cached(cache, 'k', 1000, load)]);
    expect(a).toEqual(b);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('never keeps failures or rejections', async () => {
    const cache = createTtlCache();
    const failing = vi.fn(async (): Promise<MonitoringResult<number>> => ({ ok: false, reason: 'throttled', code: 'Throttling', action: 'x' }));
    await cached(cache, 'k', 60_000, failing);
    await cached(cache, 'k', 60_000, failing);
    expect(failing).toHaveBeenCalledTimes(2);

    cache.set('r', Promise.reject(new Error('boom')), 60_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(cache.get('r')).toBeUndefined();
  });

  it('evicts the least recently used entry beyond maxEntries', async () => {
    const cache = createTtlCache({ maxEntries: 2 });
    const value = (data: number) => Promise.resolve({ ok: true as const, data });
    cache.set('a', value(1), 60_000);
    cache.set('b', value(2), 60_000);
    cache.get('a');
    cache.set('c', value(3), 60_000);
    expect(cache.size).toBe(2);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBeDefined();
    expect(cache.get('c')).toBeDefined();
  });

  it('builds keys independent of property order, and distinct per connection and region', () => {
    const at = new Date('2026-09-17T10:00:00Z');
    expect(cacheKey(scope, 'GetMetricData', { b: 1, a: [{ y: 2, x: 1 }], start: at, skip: undefined })).toBe(
      cacheKey(scope, 'GetMetricData', { a: [{ x: 1, y: 2 }], start: '2026-09-17T10:00:00.000Z', b: 1 }),
    );
    expect(cacheKey(scope, 'call', {})).not.toBe(cacheKey({ ...scope, connectionId: 'other0000000' }, 'call', {}));
    expect(cacheKey(scope, 'call', {})).not.toBe(cacheKey({ ...scope, region: 'us-east-1' }, 'call', {}));
  });
});
