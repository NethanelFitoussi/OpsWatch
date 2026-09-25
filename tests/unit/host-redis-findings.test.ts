import { describe, expect, it } from 'vitest';
import {
  REDIS_LIMIT_WARNING_PERCENT,
  REDIS_SHARE_WARNING_PERCENT,
  hostFindings,
} from '@/lib/monitoring/shared/host-findings';
import type { Host, RedisFacts } from '@opswatch/contract';

/**
 * What Redis says about itself, judged.
 *
 * The owner's own case is Redis on an Ubuntu box, where no AWS API can see inside. The agent has been
 * collecting these figures since Redis support was added and nothing looked at them.
 *
 * The hard part is not the thresholds, it is the restraint. No `maxmemory` is a legitimate
 * configuration and saying so every day would train somebody to ignore the list; `evicted_keys` is a
 * counter since start, so a number above zero looks like a problem and is not one. Both are held here.
 */

const redis = (over: Partial<RedisFacts> = {}): RedisFacts => ({
  version: '7.4.11',
  uptimeSeconds: 86_400,
  connectedClients: 3,
  usedMemoryBytes: 100_000_000,
  maxMemoryBytes: 1_000_000_000,
  evictedKeys: 0,
  keyspaceHits: 10,
  keyspaceMisses: 1,
  keys: 42,
  opsPerSecond: 5,
  role: 'master',
  connectedReplicas: 0,
  lastSaveOk: true,
  aofEnabled: false,
  ...over,
});

const host = (over: { redis?: RedisFacts | null; memoryTotalBytes?: number | null } = {}): Host =>
  ({
    id: 'h1',
    name: 'redis-box',
    state: 'healthy',
    services: [],
    redis: over.redis === undefined ? redis() : over.redis,
    latest: {
      at: 1,
      cpuPercent: 5,
      memoryUsedBytes: 2_000_000_000,
      memoryTotalBytes: over.memoryTotalBytes === undefined ? 8_000_000_000 : over.memoryTotalBytes,
      load1: 0.1,
      load5: 0.1,
      load15: 0.1,
      uptimeSeconds: 100,
      disks: [{ mount: '/', usedBytes: 1, totalBytes: 100 }],
    },
  }) as unknown as Host;

const kinds = (h: Host) => hostFindings(h).map((finding) => finding.kind);

describe('Redis, judged from what it reports', () => {
  it('says nothing about a Redis that is behaving', () => {
    expect(kinds(host())).toEqual([]);
  });

  it('THE RULING: no memory limit is only worth saying when Redis is big on this machine', () => {
    /*
     * On a box that exists to run Redis, the machine's memory *is* the limit and an operator chose
     * that. Telling them every day is how a findings list becomes something people skim. It is worth
     * a word when the two facts meet: no ceiling, and enough already used that reaching the machine's
     * own is a plausible afternoon.
     */
    const small = host({ redis: redis({ maxMemoryBytes: null, usedMemoryBytes: 100_000_000 }) });
    expect(kinds(small)).toEqual([]);

    const large = host({ redis: redis({ maxMemoryBytes: null, usedMemoryBytes: 4_000_000_000 }) });
    expect(kinds(large)).toEqual(['redis_no_memory_limit']);
    expect(hostFindings(large)[0].percent).toBe(50);

    // Exactly at the bar is worth saying; a shade under is not.
    const at = host({ redis: redis({ maxMemoryBytes: null, usedMemoryBytes: 8_000_000_000 * (REDIS_SHARE_WARNING_PERCENT / 100) }) });
    expect(kinds(at)).toEqual(['redis_no_memory_limit']);
  });

  it('THE RULING: it never reports eviction, because the figure it has cannot say whether it is happening', () => {
    /*
     * `evicted_keys` counts since Redis started. A number above zero means it evicted at some point,
     * possibly weeks ago, and OpsWatch keeps no previous value to turn it into a rate. A figure that
     * looks like a problem and is not one is worse than no figure.
     */
    expect(kinds(host({ redis: redis({ evictedKeys: 5_000_000 }) }))).toEqual([]);
  });

  it('reports being near its own limit, with the figure', () => {
    const near = host({ redis: redis({ usedMemoryBytes: 950_000_000, maxMemoryBytes: 1_000_000_000 }) });
    expect(kinds(near)).toEqual(['redis_near_memory_limit']);
    expect(hostFindings(near)[0].percent).toBe(95);

    // Below the bar it says nothing, because a cache using its cache is what a cache does.
    expect(kinds(host({ redis: redis({ usedMemoryBytes: 500_000_000, maxMemoryBytes: 1_000_000_000 }) }))).toEqual([]);
    expect(REDIS_LIMIT_WARNING_PERCENT).toBe(90);
  });

  it('THE RULING: a failed save is reported because Redis said so, not because a threshold was crossed', () => {
    const failed = host({ redis: redis({ lastSaveOk: false }) });
    expect(kinds(failed)).toEqual(['redis_last_save_failed']);
    // No figure, and none invented: Redis reported a fact, not a measurement.
    expect(hostFindings(failed)[0].percent).toBeNull();

    // And `null` is "Redis did not say", which is not "it failed".
    expect(kinds(host({ redis: redis({ lastSaveOk: null }) }))).toEqual([]);
  });

  it('says nothing about a machine with no Redis, and nothing about figures it did not get', () => {
    expect(kinds(host({ redis: null }))).toEqual([]);
    expect(kinds(host({ redis: redis({ usedMemoryBytes: null, maxMemoryBytes: null }) }))).toEqual([]);
    // No limit and an unmeasurable machine: a share of an unknown total is not a share.
    expect(kinds(host({ redis: redis({ maxMemoryBytes: null, usedMemoryBytes: 4_000_000_000 }), memoryTotalBytes: null }))).toEqual([]);
  });

  it('still says nothing at all about a machine that stopped reporting', () => {
    // Its Redis figures are as old as the silence, and a stale figure shown as current is the one
    // failure the host pages exist to avoid.
    const stale = { ...host({ redis: redis({ lastSaveOk: false }) }), state: 'stale' } as Host;
    expect(kinds(stale)).toEqual(['stopped_reporting']);
  });
});
