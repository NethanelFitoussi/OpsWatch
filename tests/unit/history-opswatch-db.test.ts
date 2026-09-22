import { describe, expect, it } from 'vitest';
import { opswatchDbProvider, atOrBelow } from '@/lib/history/opswatch-db';
import {
  HistoryRejected,
  MAX_CLOCK_SKEW_MS,
  RESOLUTIONS,
  RESOLUTION_MS,
  isAligned,
  pointKey,
  validateBatch,
  type HistoryCategory,
} from '@/lib/history/provider';
import { createTestDb } from '../helpers/db';
import { describeHistoryProvider, point } from '../helpers/history-conformance';

/** The default provider, held to exactly the same promises as any other (§33.10). */
describeHistoryProvider('opswatch-db', () => opswatchDbProvider(createTestDb()));

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const HOUR = RESOLUTION_MS['1h'];

describe('the rules every provider shares', () => {
  it('stores each resolution separately rather than deriving one from another', () => {
    // A provider that computed hours from five-minute points would have to decide what a missing point
    // means, and would get it wrong: `null` is "not measured", not zero.
    expect([...RESOLUTIONS]).toEqual(['5m', '1h', '1d']);
    for (const resolution of RESOLUTIONS) expect(RESOLUTION_MS[resolution]).toBeGreaterThan(0);
  });

  it('carries the category on every point, so one store can hold more than metrics', () => {
    const categories: HistoryCategory[] = ['metric', 'slo', 'error_rate', 'log_volume'];
    for (const category of categories) expect(pointKey(point({ category }))).toContain(category);
  });

  it('aligns an interval to its own resolution', () => {
    expect(isAligned(NOW, '1h')).toBe(true);
    expect(isAligned(NOW + 1, '1h')).toBe(false);
    expect(isAligned(NOW + 5 * 60_000, '5m')).toBe(true);
  });

  it('keys a point on exactly what §33.10 says, and nothing else', () => {
    // The value is deliberately not in the key: writing a corrected value must replace, not add.
    expect(pointKey(point({ value: 1 }))).toBe(pointKey(point({ value: 999, samples: 3 })));
    expect(pointKey(point())).not.toBe(pointKey(point({ metric: 'memory' })));
    expect(pointKey(point())).not.toBe(pointKey(point({ scope: 'eu-west-1' })));
  });

  it('refuses a clock far enough ahead to invent intervals that have not happened', () => {
    expect(() => validateBatch([point({ intervalStart: NOW + MAX_CLOCK_SKEW_MS + HOUR })], NOW)).toThrow(HistoryRejected);
    // Inside the skew is tolerated: clocks are never exactly right.
    expect(() => validateBatch([point({ intervalStart: NOW })], NOW)).not.toThrow();
  });

  it('accepts a clock behind, because backfilling old intervals is legitimate', () => {
    expect(() => validateBatch([point({ intervalStart: NOW - 1000 * HOUR })], NOW)).not.toThrow();
  });

  it('names the reason it refused, so a caller can tell a bug from a misconfiguration', () => {
    try {
      validateBatch([point({ intervalStart: NOW + 1 })], NOW);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as HistoryRejected).reason).toBe('misaligned');
    }
  });
});

describe('the watermark', () => {
  it('marks the END of the last complete interval, not its start', async () => {
    const provider = opswatchDbProvider(createTestDb());
    await provider.write([point({ intervalStart: NOW - HOUR })], NOW);
    // An interval starting an hour ago with hourly resolution is complete *now*. A watermark at its start
    // would leave the hour looking unwritten and a reader would discard it.
    expect(await provider.watermark({ category: 'metric', subjectId: 'prod/web', metric: 'cpu', connectionId: 'c1', scope: 'us-east-1', resolution: '1h' })).toBe(NOW);
  });

  it('never goes backwards when an older gap is filled later', async () => {
    const provider = opswatchDbProvider(createTestDb());
    const series = { category: 'metric' as const, subjectId: 'prod/web', metric: 'cpu', connectionId: 'c1', scope: 'us-east-1', resolution: '1h' as const };
    await provider.write([point({ intervalStart: NOW - HOUR })], NOW);
    await provider.write([point({ intervalStart: NOW - 10 * HOUR })], NOW);
    // Backfilling history must not un-complete newer data that readers have already acted on.
    expect(await provider.watermark(series)).toBe(NOW);
  });

  it('is zero before anything is written, which is the honest direction to be wrong in', async () => {
    const provider = opswatchDbProvider(createTestDb());
    const mark = await provider.watermark({ category: 'metric', subjectId: 'nobody', metric: 'cpu', connectionId: 'c1', scope: 'us-east-1', resolution: '1h' });
    // Zero means "nothing is complete". "Now" would mean "everything is complete", which is the dangerous
    // direction: a detector would then read an empty series and conclude all was well.
    expect(mark).toBe(0);
  });

  it('hides a point written above the watermark from a reader', async () => {
    const db = createTestDb();
    const provider = opswatchDbProvider(db);
    await provider.write([point({ intervalStart: NOW - HOUR })], NOW);
    // A second series' watermark must not make this one's future data readable.
    const result = await provider.read({
      category: 'metric', subjectId: 'prod/web', metric: 'cpu', connectionId: 'c1', scope: 'us-east-1',
      resolution: '1h', from: NOW - 10 * HOUR, to: NOW + 10 * HOUR,
    });
    expect(result.points.every((stored) => stored.intervalStart <= result.watermark)).toBe(true);
    expect(result.partial).toBe(true);
  });

  it('bounds a query to complete data, which is what a detector must do', () => {
    const query = { category: 'metric' as const, subjectId: 's', metric: 'cpu', connectionId: 'c1', scope: 'us-east-1', resolution: '1h' as const, from: 0, to: NOW + 10 * HOUR };
    expect(atOrBelow(query, NOW).to).toBe(NOW);
    // It only ever narrows: a caller asking for less than the watermark still gets what it asked for.
    expect(atOrBelow({ ...query, to: NOW - HOUR }, NOW).to).toBe(NOW - HOUR);
  });
});
