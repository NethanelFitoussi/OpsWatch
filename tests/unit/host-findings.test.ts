import { describe, expect, it } from 'vitest';
import type { Host } from '@opswatch/contract';
import { DISK_CRITICAL_PERCENT, DISK_WARNING_PERCENT, hostFindings, worstFinding } from '@/lib/monitoring/shared/host-findings';

/**
 * What is wrong with a machine, from its own last reading.
 *
 * The failures worth breaking deliberately are all the same failure in different clothes: a page
 * stating something it did not measure. A disk whose size is unknown is not a disk that is full, and a
 * host that stopped reporting an hour ago has no current figures at all.
 */

const host = (over: Partial<Host> = {}): Host =>
  ({
    id: 'h1',
    name: 'api-prod-03',
    state: 'healthy',
    hostname: 'api-prod-03',
    os: null,
    kernel: null,
    arch: null,
    cloud: 'unknown',
    cloudInstanceId: null,
    agentVersion: null,
    enrolledAt: 1,
    lastSeenAt: 2,
    services: [],
    redis: null,
    latest: {
      at: 2,
      cpuPercent: 10,
      memoryUsedBytes: 1_000_000_000,
      memoryTotalBytes: 8_000_000_000,
      load1: 0.1,
      load5: 0.1,
      load15: 0.1,
      uptimeSeconds: 100,
      disks: [],
    },
    ...over,
  }) as Host;

const disks = (...entries: { mount: string; usedBytes: number | null; totalBytes: number | null }[]) =>
  host({ latest: { ...host().latest!, disks: entries } });

describe('a filesystem filling up', () => {
  it('says nothing while there is room', () => {
    expect(hostFindings(disks({ mount: '/', usedBytes: 50, totalBytes: 100 }))).toEqual([]);
  });

  it('warns at the threshold and shouts at the higher one', () => {
    const warned = hostFindings(disks({ mount: '/', usedBytes: DISK_WARNING_PERCENT, totalBytes: 100 }));
    expect(warned).toMatchObject([{ kind: 'disk_nearly_full', level: 'warning', subject: '/' }]);

    const critical = hostFindings(disks({ mount: '/', usedBytes: DISK_CRITICAL_PERCENT, totalBytes: 100 }));
    expect(critical).toMatchObject([{ kind: 'disk_full', level: 'critical' }]);
  });

  it('THE RULING: a filesystem it could not measure is not a filesystem that is full', () => {
    // The agent reads `df`; a mount it could not size reports null. Treating that as 100% would invent
    // an emergency out of a missing measurement — and treating it as 0% would invent an all-clear.
    expect(hostFindings(disks({ mount: '/', usedBytes: null, totalBytes: null }))).toEqual([]);
    expect(hostFindings(disks({ mount: '/', usedBytes: 99, totalBytes: null }))).toEqual([]);
    // And a filesystem of zero bytes has no percentage, rather than a division by zero.
    expect(hostFindings(disks({ mount: '/', usedBytes: 0, totalBytes: 0 }))).toEqual([]);
  });

  it('reports every filesystem that is full, worst first', () => {
    const findings = hostFindings(
      disks(
        { mount: '/var', usedBytes: 88, totalBytes: 100 },
        { mount: '/', usedBytes: 99, totalBytes: 100 },
        { mount: '/home', usedBytes: 92, totalBytes: 100 },
      ),
    );
    expect(findings.map((one) => one.subject)).toEqual(['/', '/home', '/var']);
    expect(worstFinding(findings)).toBe('critical');
  });
});

describe('THE RULING: a machine that stopped reporting has no current figures', () => {
  it('says only that, and does not repeat a reading from before the silence', () => {
    /*
     * The last sample is however old the silence is. Listing "disk 91% full" beside "stopped reporting"
     * would present a figure from an hour ago as though it were now — which is the mistake the stale
     * state exists to prevent, made on the same page that names it.
     */
    const stale = disks({ mount: '/', usedBytes: 99, totalBytes: 100 });
    const findings = hostFindings({ ...stale, state: 'stale' });
    expect(findings).toMatchObject([{ kind: 'stopped_reporting', level: 'critical' }]);
    expect(findings).toHaveLength(1);
  });

  it('finds nothing at all on a host that has never reported', () => {
    // There is nothing to have found. `waiting` is not a fault, and inventing one would make it look it.
    expect(hostFindings(host({ state: 'waiting', latest: null, lastSeenAt: null }))).toEqual([]);
    expect(worstFinding([])).toBeNull();
  });
});

describe('memory', () => {
  it('says nothing at ordinary use, and warns when there is almost none left', () => {
    expect(hostFindings(host())).toEqual([]);
    const tight = host({ latest: { ...host().latest!, memoryUsedBytes: 7_800_000_000, memoryTotalBytes: 8_000_000_000 } });
    expect(hostFindings(tight)).toMatchObject([{ kind: 'memory_nearly_exhausted', level: 'warning' }]);
  });

  it('says nothing when it could not be measured', () => {
    const unknown = host({ latest: { ...host().latest!, memoryUsedBytes: null, memoryTotalBytes: null } });
    expect(hostFindings(unknown)).toEqual([]);
  });
});
