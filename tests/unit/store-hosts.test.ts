import { describe, expect, it } from 'vitest';
import { HOST_STALE_AFTER_MS } from '@opswatch/contract';
import {
  createHost,
  deleteHost,
  hostClaiming,
  hostSecret,
  hostState,
  listHosts,
  listSamples,
  pruneSamples,
  recordReport,
  toHost,
} from '@/lib/store/hosts';
import { createTestDb } from '../helpers/db';

/**
 * Linux hosts (§E).
 *
 * Three things are worth breaking deliberately here: the three states a host can be in, which must
 * never collapse into two; the machine identity, which must not let one machine become two hosts or one
 * host become two machines; and the secret, which must not be readable by anything but the signature
 * check.
 */

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const SECRET = 'instance-secret'.padEnd(32, 'x');

const identity = (over: Record<string, unknown> = {}) => ({
  hostname: 'api-prod-03',
  machineId: 'f0e1d2c3b4a5',
  os: 'Ubuntu 24.04.1 LTS',
  kernel: '6.8.0-51-generic',
  arch: 'x86_64',
  cloud: 'aws' as const,
  cloudInstanceId: 'i-0abc123',
  agentVersion: '1.0.0',
  ...over,
});

const sample = (over: Record<string, unknown> = {}) => ({
  cpuPercent: 12.5,
  memoryUsedBytes: 2_000_000_000,
  memoryTotalBytes: 8_000_000_000,
  load1: 0.4,
  load5: 0.3,
  load15: 0.2,
  uptimeSeconds: 864_000,
  disks: [{ mount: '/', usedBytes: 10_000_000_000, totalBytes: 50_000_000_000 }],
  ...over,
});

describe('enrolling a host', () => {
  it('mints a key and keeps it encrypted, readable only through the store', () => {
    const db = createTestDb();
    const { host, agentSecret } = createHost(db, { name: 'api-prod-03', nowMs: NOW }, SECRET);

    // 32 bytes of randomness, base64url — plenty for an HMAC key and short enough to paste.
    expect(agentSecret.length).toBeGreaterThanOrEqual(40);
    // Never the plaintext: a row a page can read is a row a page can leak.
    expect(host.secretCiphertext).not.toContain(agentSecret);
    expect(hostSecret(db, host.id, SECRET)).toBe(agentSecret);
  });

  it('cannot read a key sealed under a different instance secret, and says so with null', () => {
    // An operator who changed OPSWATCH_SECRET has hosts that must be enrolled again. Throwing here
    // would turn that into a 500 on the ingestion endpoint rather than a refused signature.
    const db = createTestDb();
    const { host } = createHost(db, { name: 'a', nowMs: NOW }, SECRET);
    expect(hostSecret(db, host.id, 'a-different-secret'.padEnd(32, 'y'))).toBeNull();
  });
});

describe('THE RULING: waiting, reporting and stopped are three different answers', () => {
  it('a host that has never reported is waiting, not unhealthy', () => {
    /*
     * A host enrolled a minute ago whose agent has not run yet is not a problem. Colouring it as one
     * trains an operator to ignore the colour, which is how a monitoring tool stops being read.
     */
    expect(hostState({ lastSeenAt: null }, NOW)).toBe('waiting');
  });

  it('a host that reported recently is reporting', () => {
    expect(hostState({ lastSeenAt: NOW - 60_000 }, NOW)).toBe('healthy');
  });

  it('THE RULING: a host that stopped is stale, which is not "fine"', () => {
    // "OpsWatch cannot tell you anything current about this machine" and "this machine is fine" must
    // never look the same, which is the whole reason the third state exists.
    expect(hostState({ lastSeenAt: NOW - HOST_STALE_AFTER_MS - 1 }, NOW)).toBe('stale');
    // And exactly at the boundary it is still reporting: the window is inclusive.
    expect(hostState({ lastSeenAt: NOW - HOST_STALE_AFTER_MS }, NOW)).toBe('healthy');
  });
});

describe('a report', () => {
  it('records the reading and the machine, and counts the first one as the enrolment', () => {
    const db = createTestDb();
    const { host } = createHost(db, { name: 'api-prod-03', nowMs: NOW }, SECRET);
    expect(host.enrolledAt).toBeNull();

    recordReport(db, { hostId: host.id, identity: identity(), sample: sample(), atMs: NOW });
    const [one] = listHosts(db, NOW);
    expect(one.state).toBe('healthy');
    expect(one.enrolledAt).toBe(NOW);
    expect(one.os).toBe('Ubuntu 24.04.1 LTS');
    expect(one.latest?.cpuPercent).toBe(12.5);
  });

  it('keeps the identity current, because a kernel and an agent are upgraded', () => {
    const db = createTestDb();
    const { host } = createHost(db, { name: 'a', nowMs: NOW }, SECRET);
    recordReport(db, { hostId: host.id, identity: identity(), sample: sample(), atMs: NOW });
    recordReport(db, { hostId: host.id, identity: identity({ kernel: '6.11.0-1-generic' }), sample: sample(), atMs: NOW + 60_000 });

    const [one] = listHosts(db, NOW + 60_000);
    expect(one.kernel).toBe('6.11.0-1-generic');
    // And the enrolment stays when it was, rather than moving to the newest report.
    expect(one.enrolledAt).toBe(NOW);
  });

  it('THE RULING: a figure the agent could not read stays null, never zero', () => {
    /*
     * A CPU percentage is a rate and needs two readings, so the agent's first run has none. Printing
     * `0%` would be a number nobody measured — and 0% CPU is a plausible-looking lie.
     */
    const db = createTestDb();
    const { host } = createHost(db, { name: 'a', nowMs: NOW }, SECRET);
    recordReport(db, {
      hostId: host.id,
      identity: identity(),
      sample: sample({ cpuPercent: null, memoryUsedBytes: null, load1: null, uptimeSeconds: null, disks: [] }),
      atMs: NOW,
    });

    const [one] = listHosts(db, NOW);
    expect(one.latest?.cpuPercent).toBeNull();
    expect(one.latest?.memoryUsedBytes).toBeNull();
    expect(one.latest?.load1).toBeNull();
    expect(one.latest?.uptimeSeconds).toBeNull();
  });

  it('never moves a host onto a different machine', () => {
    // The machine id is written once. A report carrying a different one is a different machine, which
    // is an enrolment rather than a report — and silently rewriting it would attribute one machine's
    // readings to another.
    const db = createTestDb();
    const { host } = createHost(db, { name: 'a', nowMs: NOW }, SECRET);
    recordReport(db, { hostId: host.id, identity: identity(), sample: sample(), atMs: NOW });
    recordReport(db, { hostId: host.id, identity: identity({ machineId: 'somebody-else' }), sample: sample(), atMs: NOW + 1000 });

    expect(hostClaiming(db, 'f0e1d2c3b4a5')?.id).toBe(host.id);
    expect(hostClaiming(db, 'somebody-else')).toBeNull();
  });

  it('THE RULING: one machine cannot become two hosts', () => {
    // `machine_id` is unique, so the second enrolment of one machine fails at the index rather than
    // producing two hosts whose readings interleave.
    const db = createTestDb();
    const first = createHost(db, { name: 'first', nowMs: NOW }, SECRET);
    const second = createHost(db, { name: 'second', nowMs: NOW }, SECRET);
    recordReport(db, { hostId: first.host.id, identity: identity(), sample: sample(), atMs: NOW });

    expect(() => recordReport(db, { hostId: second.host.id, identity: identity(), sample: sample(), atMs: NOW })).toThrow();
    expect(hostClaiming(db, 'f0e1d2c3b4a5')?.id).toBe(first.host.id);
  });
});

describe('bounds and removal', () => {
  it('keeps only what it says it keeps, so one machine cannot fill a disk', () => {
    const db = createTestDb();
    const { host } = createHost(db, { name: 'a', nowMs: NOW }, SECRET);
    for (let i = 0; i < 20; i += 1) {
      recordReport(db, { hostId: host.id, identity: identity(), sample: sample(), atMs: NOW + i * 1000 });
    }
    expect(pruneSamples(db, host.id, 5)).toBe(15);
    expect(listSamples(db, host.id, 100)).toHaveLength(5);
    // The newest are what survive: an operator looking at a host wants the recent readings.
    expect(listSamples(db, host.id, 1)[0]?.at).toBe(NOW + 19 * 1000);
  });

  it('takes a host’s readings with it, leaving none nobody can attribute', () => {
    const db = createTestDb();
    const { host } = createHost(db, { name: 'a', nowMs: NOW }, SECRET);
    recordReport(db, { hostId: host.id, identity: identity(), sample: sample(), atMs: NOW });

    expect(deleteHost(db, host.id)).toBe(1);
    expect(listSamples(db, host.id, 10)).toEqual([]);
    expect(listHosts(db, NOW)).toEqual([]);
  });

  it('describes a host with no readings as having none, rather than as having zeroes', () => {
    const db = createTestDb();
    const { host } = createHost(db, { name: 'a', nowMs: NOW }, SECRET);
    expect(toHost(host, null, NOW).latest).toBeNull();
  });
});
