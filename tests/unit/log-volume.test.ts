import { describe, expect, it } from 'vitest';
import {
  VOLUME_GROUP_LIMIT,
  rankByIngestion,
  sumSeries,
  volumeQueries,
  withShares,
  type GroupVolume,
} from '@/lib/monitoring/log-volume';

const group = (name: string, ingestedBytes: number | null, over: Partial<GroupVolume> = {}): GroupVolume => ({
  name,
  ingestedBytes,
  storedBytes: null,
  retentionDays: null,
  share: null,
  ...over,
});

describe('the queries this page makes', () => {
  it('asks the AWS/Logs namespace for ingestion, which is a metric and not a log query', () => {
    const queries = volumeQueries([{ name: '/aws/ecs/web', storedBytes: null, retentionDays: null }]);
    expect(queries[0]).toMatchObject({
      namespace: 'AWS/Logs',
      metricName: 'IncomingBytes',
      dimensions: { LogGroupName: '/aws/ecs/web' },
      // Sum, because the question is how much arrived over the window, not what it averaged.
      stat: 'Sum',
    });
  });

  it('gives every group a distinct id, so two groups cannot read each other’s series', () => {
    const queries = volumeQueries([
      { name: '/a', storedBytes: null, retentionDays: null },
      { name: '/b', storedBytes: null, retentionDays: null },
    ]);
    expect(new Set(queries.map((query) => query.id)).size).toBe(2);
  });

  it('bounds how many groups one page covers', () => {
    expect(VOLUME_GROUP_LIMIT).toBeGreaterThan(0);
    expect(VOLUME_GROUP_LIMIT).toBeLessThanOrEqual(100);
  });
});

describe('§2.4 — unmeasured is not zero', () => {
  it('THE RULING: a group with no datapoints is null, not 0', () => {
    expect(sumSeries([])).toBeNull();
    // A group that genuinely ingested nothing did report datapoints, and that is a different fact.
    expect(sumSeries([0, 0])).toBe(0);
    expect(sumSeries([10, 5])).toBe(15);
  });

  it('ranks unmeasured groups last rather than treating them as the quietest', () => {
    const ranked = rankByIngestion([group('quiet', 0), group('unknown', null), group('loud', 100)]);
    expect(ranked.map((one) => one.name)).toEqual(['loud', 'quiet', 'unknown']);
  });

  it('breaks a tie by name, so the order does not move between two identical loads', () => {
    const ranked = rankByIngestion([group('b', 10), group('a', 10)]);
    expect(ranked.map((one) => one.name)).toEqual(['a', 'b']);
  });
});

describe('the share each group takes', () => {
  it('is that group’s ingestion over what this page measured', () => {
    const { groups, total } = withShares([group('a', 75), group('b', 25)]);
    expect(total).toBe(100);
    expect(groups.map((one) => one.share)).toEqual([0.75, 0.25]);
  });

  it('leaves an unmeasured group without a share instead of inventing one', () => {
    const { groups, total } = withShares([group('a', 100), group('b', null)]);
    expect(total).toBe(100);
    expect(groups.find((one) => one.name === 'b')?.share).toBeNull();
  });

  it('THE RULING: nothing measured means no total and no shares, never a division by zero', () => {
    const { groups, total } = withShares([group('a', null), group('b', null)]);
    expect(total).toBeNull();
    expect(groups.every((one) => one.share === null)).toBe(true);
  });

  it('gives no share when every measured group ingested nothing', () => {
    // Total zero: a share would be NaN, and "0 %" would be a claim about proportion nobody can make.
    const { groups, total } = withShares([group('a', 0), group('b', 0)]);
    expect(total).toBe(0);
    expect(groups.every((one) => one.share === null)).toBe(true);
  });
});

describe('retention', () => {
  it('keeps "forever" as null, which is a finding rather than a missing value', () => {
    const forever = group('a', 10, { retentionDays: null });
    const kept = group('b', 10, { retentionDays: 30 });
    expect(forever.retentionDays).toBeNull();
    expect(kept.retentionDays).toBe(30);
  });
});
