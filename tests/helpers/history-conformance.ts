import { expect, describe, it } from 'vitest';
import {
  HistoryRejected,
  MAX_CLOCK_SKEW_MS,
  RESOLUTION_MS,
  type HistoricalStorageProvider,
  type HistoryPoint,
} from '@/lib/history/provider';

/**
 * The conformance suite of **§33.10**, run against every `HistoricalStorageProvider` including the default
 * one. A provider that cannot pass it is not shipped.
 *
 * The interface is not a list of method names: a detector reads from whatever an operator plugged in, and it
 * has to be able to trust the answer. These are the promises that make that possible, each written as
 * something a wrong implementation would actually fail.
 */
const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const HOUR = RESOLUTION_MS['1h'];

export type ProviderFactory = () => HistoricalStorageProvider | Promise<HistoricalStorageProvider>;

export function point(over: Partial<HistoryPoint> = {}): HistoryPoint {
  return {
    category: 'metric',
    subjectId: 'prod/web',
    metric: 'cpu',
    connectionId: 'c1',
    scope: 'us-east-1',
    intervalStart: NOW - HOUR,
    resolution: '1h',
    value: 42,
    samples: 12,
    ...over,
  };
}

const query = (over: Partial<Parameters<HistoricalStorageProvider['read']>[0]> = {}) => ({
  category: 'metric' as const,
  subjectId: 'prod/web',
  metric: 'cpu',
  connectionId: 'c1',
  scope: 'us-east-1',
  resolution: '1h' as const,
  from: NOW - 24 * HOUR,
  to: NOW + HOUR,
  ...over,
});

/** Runs the whole suite against one provider. Call it from that provider's own test file. */
export function describeHistoryProvider(name: string, create: ProviderFactory): void {
  describe(`${name} — §33.10 conformance`, () => {
    it('names itself, so System status can say what is storing the history', async () => {
      expect((await create()).id.length).toBeGreaterThan(0);
    });

    it('GUARANTEE 1: writing the same batch twice leaves the same state', async () => {
      const provider = await create();
      const batch = [point(), point({ intervalStart: NOW - 2 * HOUR, value: 40 })];
      await provider.write(batch, NOW);
      await provider.write(batch, NOW);
      const result = await provider.read(query());
      // A crash mid-batch is recovered by replaying it, which is only safe if replay is a no-op.
      expect(result.points).toHaveLength(2);
      expect(result.points.map((p) => p.value).sort()).toEqual([40, 42]);
    });

    it('GUARANTEE 1: a later write of the same key replaces the value rather than adding a row', async () => {
      const provider = await create();
      await provider.write([point({ value: 10, samples: 1 })], NOW);
      await provider.write([point({ value: 99, samples: 12 })], NOW);
      const result = await provider.read(query());
      expect(result.points).toHaveLength(1);
      expect({ value: result.points[0].value, samples: result.points[0].samples }).toEqual({ value: 99, samples: 12 });
    });

    it('GUARANTEE 2: a batch is visible all or nothing', async () => {
      const provider = await create();
      const good = point({ intervalStart: NOW - 3 * HOUR });
      // One bad point in the batch: nothing from it may be readable afterwards.
      const bad = point({ intervalStart: NOW - 3 * HOUR + 7, metric: 'memory' });
      await expect(provider.write([good, bad], NOW)).rejects.toBeInstanceOf(HistoryRejected);
      const result = await provider.read(query({ from: NOW - 4 * HOUR, to: NOW }));
      expect(result.points).toEqual([]);
    });

    it('GUARANTEE 3: every read carries the watermark it is complete to', async () => {
      const provider = await create();
      await provider.write([point()], NOW);
      const result = await provider.read(query());
      expect(typeof result.watermark).toBe('number');
      // Everything returned at or below the watermark is complete.
      for (const stored of result.points) expect(stored.intervalStart).toBeLessThanOrEqual(result.watermark);
    });

    it('GUARANTEE 3: a range past the watermark says it is partial rather than looking complete', async () => {
      const provider = await create();
      await provider.write([point()], NOW);
      const asked = await provider.read(query({ to: NOW + 10 * HOUR }));
      expect(asked.partial).toBe(true);
      const within = await provider.read(query({ to: NOW - HOUR }));
      expect(within.partial).toBe(false);
    });

    it('GUARANTEE 4: a timestamp beyond the permitted skew is refused, not stored', async () => {
      const provider = await create();
      const future = point({ intervalStart: NOW + MAX_CLOCK_SKEW_MS + HOUR });
      await expect(provider.write([future], NOW)).rejects.toBeInstanceOf(HistoryRejected);
      // And nothing of it was kept: a writer with a wrong clock must not poison the series.
      const result = await provider.read(query({ to: NOW + 100 * HOUR }));
      expect(result.points).toEqual([]);
    });

    it('GUARANTEE 4: an interval not aligned to its resolution is refused', async () => {
      const provider = await create();
      await expect(provider.write([point({ intervalStart: NOW - HOUR + 1 })], NOW)).rejects.toBeInstanceOf(HistoryRejected);
    });

    it('GUARANTEE 5: the watermark never runs ahead of what has been written', async () => {
      const provider = await create();
      await provider.write([point({ intervalStart: NOW - 5 * HOUR })], NOW);
      const mark = await provider.watermark(query());
      // A detector reads at or below this. If it ran ahead, the engine could open a problem from half a cycle.
      expect(mark).toBeLessThanOrEqual(NOW);
    });

    it('keeps resolutions apart rather than deriving one from another', async () => {
      const provider = await create();
      await provider.write([point({ resolution: '1h', value: 42 })], NOW);
      await provider.write([point({ resolution: '5m', intervalStart: NOW - RESOLUTION_MS['5m'], value: 7 })], NOW);
      expect((await provider.read(query({ resolution: '1h' }))).points.map((p) => p.value)).toEqual([42]);
      expect((await provider.read(query({ resolution: '5m' }))).points.map((p) => p.value)).toEqual([7]);
    });

    it('keeps two environments apart', async () => {
      const provider = await create();
      await provider.write([point({ value: 1 })], NOW);
      await provider.write([point({ scope: 'eu-west-1', value: 2 })], NOW);
      expect((await provider.read(query())).points.map((p) => p.value)).toEqual([1]);
      expect((await provider.read(query({ scope: 'eu-west-1' }))).points.map((p) => p.value)).toEqual([2]);
    });

    it('stores "not measured" as null rather than as zero', async () => {
      const provider = await create();
      await provider.write([point({ value: null, samples: 0 })], NOW);
      const [stored] = (await provider.read(query())).points;
      expect(stored.value).toBeNull();
      expect(stored.value).not.toBe(0);
    });

    it('answers an empty range without inventing points', async () => {
      const provider = await create();
      const result = await provider.read(query({ from: NOW - 100 * HOUR, to: NOW - 99 * HOUR }));
      expect(result.points).toEqual([]);
    });

    it('accepts an empty batch without complaint', async () => {
      const provider = await create();
      await expect(provider.write([], NOW)).resolves.toBeUndefined();
    });

    it('purges what is older than a cutoff and keeps the rest', async () => {
      const provider = await create();
      await provider.write([point({ intervalStart: NOW - 10 * HOUR }), point({ intervalStart: NOW - HOUR })], NOW);
      expect(await provider.purge(NOW - 5 * HOUR)).toBe(1);
      expect((await provider.read(query())).points.map((p) => p.intervalStart)).toEqual([NOW - HOUR]);
    });
  });
}
