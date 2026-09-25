import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { HOST_STALE_AFTER_MS } from '@opswatch/contract';
import {
  createHost,
  deleteHost,
  findHost,
  hostClaiming,
  hostSecret,
  hostsByCloudInstance,
  hostsInEnvironment,
  linkHostToConnection,
  unlinkHostFromConnection,
  hostState,
  listHosts,
  listSamples,
  pruneSamples,
  recordReport,
  toHost,
} from '@/lib/store/hosts';
import { hosts as schemaHosts } from '@/lib/db/schema';
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

describe('what is running on a host', () => {
  const service = (over: Record<string, unknown> = {}) => ({
    kind: 'redis' as const,
    name: 'redis-server',
    port: 6379,
    version: null,
    evidence: 'Listening on port 6379, held by a process called redis-server',
    ...over,
  });

  const redis = (over: Record<string, unknown> = {}) => ({
    version: '7.4.11',
    uptimeSeconds: 900,
    connectedClients: 3,
    usedMemoryBytes: 1_137_664,
    maxMemoryBytes: null,
    evictedKeys: 0,
    keyspaceHits: 90,
    keyspaceMisses: 10,
    keys: 4,
    opsPerSecond: 12,
    role: 'master',
    connectedReplicas: 0,
    lastSaveOk: true,
    aofEnabled: false,
    ...over,
  });

  it('keeps what the agent found, with the evidence it gave', () => {
    const db = createTestDb();
    const { host } = createHost(db, { name: 'a', nowMs: NOW }, SECRET);
    recordReport(db, { hostId: host.id, identity: identity(), sample: sample(), services: [service()], redis: redis(), atMs: NOW });

    const [one] = listHosts(db, NOW);
    expect(one.services).toHaveLength(1);
    // The sentence the agent wrote, not one the server invented: discovery is a guess, and the page
    // has to be able to say how it was made.
    expect(one.services[0].evidence).toContain('Listening on port 6379');
    expect(one.redis?.version).toBe('7.4.11');
    expect(one.redis?.keys).toBe(4);
  });

  it('THE RULING: an agent that did not look does not blank what the last one found', () => {
    /*
     * `undefined` and `[]` are different answers. An older agent sends nothing because it cannot look;
     * a current one that looked and found nothing sends an empty list. Treating the first as the second
     * would empty the page every time an out-of-date machine reported.
     */
    const db = createTestDb();
    const { host } = createHost(db, { name: 'a', nowMs: NOW }, SECRET);
    recordReport(db, { hostId: host.id, identity: identity(), sample: sample(), services: [service()], redis: redis(), atMs: NOW });

    recordReport(db, { hostId: host.id, identity: identity(), sample: sample(), atMs: NOW + 1000 });
    const [kept] = listHosts(db, NOW + 1000);
    expect(kept.services).toHaveLength(1);
    expect(kept.redis).not.toBeNull();
  });

  it('THE RULING: an agent that looked and found nothing clears it', () => {
    // Redis was uninstalled. A page still showing it would be showing something that is not there.
    const db = createTestDb();
    const { host } = createHost(db, { name: 'a', nowMs: NOW }, SECRET);
    recordReport(db, { hostId: host.id, identity: identity(), sample: sample(), services: [service()], redis: redis(), atMs: NOW });

    recordReport(db, { hostId: host.id, identity: identity(), sample: sample(), services: [], atMs: NOW + 1000 });
    const [cleared] = listHosts(db, NOW + 1000);
    expect(cleared.services).toEqual([]);
  });

  it('drops a stored service that no longer matches the schema rather than rendering it', () => {
    const db = createTestDb();
    const { host } = createHost(db, { name: 'a', nowMs: NOW }, SECRET);
    // What an older build might have written. It is parsed back, not trusted.
    recordReport(db, {
      hostId: host.id,
      identity: identity(),
      sample: sample(),
      services: [service(), { nonsense: true } as unknown as ReturnType<typeof service>],
      atMs: NOW,
    });
    expect(listHosts(db, NOW)[0].services).toHaveLength(1);
  });

  it('says Redis has no memory limit rather than a limit of zero', () => {
    // `maxmemory: 0` is how Redis says "no limit", and rendering it as a 0-byte ceiling would read as a
    // server that may use nothing at all.
    const db = createTestDb();
    const { host } = createHost(db, { name: 'a', nowMs: NOW }, SECRET);
    recordReport(db, { hostId: host.id, identity: identity(), sample: sample(), redis: redis({ maxMemoryBytes: null }), atMs: NOW });
    expect(listHosts(db, NOW)[0].redis?.maxMemoryBytes).toBeNull();
  });
});

describe('THE RULING: one machine, two sources — matched on identity, never on a name', () => {
  it('finds the host reporting from an instance, by the id the provider gave it', () => {
    const db = createTestDb();
    const { host } = createHost(db, { name: 'api-prod-03', nowMs: NOW }, SECRET);
    recordReport(db, { hostId: host.id, identity: identity({ cloudInstanceId: 'i-0abc123' }), sample: sample(), atMs: NOW });

    const found = hostsByCloudInstance(db, ['i-0abc123', 'i-0nothing']);
    expect(found.get('i-0abc123')?.id).toBe(host.id);
    expect(found.has('i-0nothing')).toBe(false);
  });

  it('never matches on a hostname, however suggestive', () => {
    /*
     * Two machines can be called api-prod-03. Merging them would attribute one machine's CPU, memory
     * and disks to another — and the operator would have no way to see that it had happened.
     */
    const db = createTestDb();
    const { host } = createHost(db, { name: 'a', nowMs: NOW }, SECRET);
    recordReport(db, { hostId: host.id, identity: identity({ cloudInstanceId: undefined }), sample: sample(), atMs: NOW });

    // The hostname is api-prod-03 and so is the instance's Name tag; there is still no match.
    expect(hostsByCloudInstance(db, ['api-prod-03']).size).toBe(0);
  });

  it('writes the link once, and not again on every render', () => {
    // The instances page calls this each time it draws. A page that wrote on every render would turn
    // reading a table into a stream of updates.
    const db = createTestDb();
    const { host } = createHost(db, { name: 'a', nowMs: NOW }, SECRET);
    expect(linkHostToConnection(db, host.id, 'c1', 'eu-west-1', NOW)).toBe(true);
    expect(linkHostToConnection(db, host.id, 'c1', 'eu-west-1', NOW + 1000)).toBe(false);
    expect(findHost(db, host.id)?.connectionId).toBe('c1');
  });

  it('records the region beside the account, because every scoped read is keyed by the pair', () => {
    const db = createTestDb();
    const { host } = createHost(db, { name: 'a', nowMs: NOW }, SECRET);
    linkHostToConnection(db, host.id, 'c1', 'eu-west-1', NOW);
    expect(findHost(db, host.id)).toMatchObject({ connectionId: 'c1', region: 'eu-west-1' });
  });

  it('THE RULING: a second connection over the same AWS account does not take the machine', () => {
    /*
     * Nothing stops an operator connecting one AWS account twice — `createConnection` has no
     * uniqueness check on the account id, and two connections over one account is a configuration the
     * rest of this product already handles. Both list the same instance. An earlier version overwrote
     * the link whenever it differed, so the machine moved from one account to the other every time
     * either instances page was rendered: which account owned it depended on which tab was open last.
     */
    const db = createTestDb();
    const { host } = createHost(db, { name: 'a', nowMs: NOW }, SECRET);
    linkHostToConnection(db, host.id, 'c1', 'eu-west-1', NOW);

    expect(linkHostToConnection(db, host.id, 'c2', 'eu-west-1', NOW + 1000)).toBe(false);
    expect(findHost(db, host.id)?.connectionId).toBe('c1');
    // …and rendering the first account's page again does not write either.
    expect(linkHostToConnection(db, host.id, 'c1', 'eu-west-1', NOW + 2000)).toBe(false);
  });

  it('fills in a region that was never recorded, without moving the machine', () => {
    // Links written before the region column existed name an account and nowhere in it.
    const db = createTestDb();
    const { host } = createHost(db, { name: 'a', nowMs: NOW }, SECRET);
    linkHostToConnection(db, host.id, 'c1', 'eu-west-1', NOW);
    db.update(schemaHosts).set({ region: null }).where(eq(schemaHosts.id, host.id)).run();

    expect(linkHostToConnection(db, host.id, 'c1', 'eu-west-2', NOW + 1000)).toBe(true);
    expect(findHost(db, host.id)).toMatchObject({ connectionId: 'c1', region: 'eu-west-2' });
  });

  it('can be detached, so a link that is wrong is not permanent', () => {
    const db = createTestDb();
    const { host } = createHost(db, { name: 'a', nowMs: NOW }, SECRET);
    linkHostToConnection(db, host.id, 'c1', 'eu-west-1', NOW);

    expect(unlinkHostFromConnection(db, host.id, NOW + 1000)).toBe(true);
    expect(findHost(db, host.id)).toMatchObject({ connectionId: null, region: null });
    // Detaching twice is not an error, and it is not a write either.
    expect(unlinkHostFromConnection(db, host.id, NOW + 2000)).toBe(false);

    // And the account that can actually see the instance may now place it.
    expect(linkHostToConnection(db, host.id, 'c2', 'us-east-1', NOW + 3000)).toBe(true);
    expect(findHost(db, host.id)).toMatchObject({ connectionId: 'c2', region: 'us-east-1' });
  });

  it('says nothing when asked about no instances at all', () => {
    expect(hostsByCloudInstance(createTestDb(), []).size).toBe(0);
  });
});

describe('the machines placed in one account and region', () => {
  const placed = (db: ReturnType<typeof createTestDb>, name: string, connectionId: string | null, region: string | null) => {
    const { host } = createHost(db, { name, nowMs: NOW }, SECRET);
    if (connectionId !== null) db.update(schemaHosts).set({ connectionId, region }).where(eq(schemaHosts.id, host.id)).run();
    return host;
  };

  it('THE RULING: it answers for one environment, not for one account', () => {
    // A connection may read several regions. An account-wide answer on a region's page would name
    // machines in regions that page is not about, which is the mistake the region column exists to stop.
    const db = createTestDb();
    placed(db, 'in eu-west-1', 'c1', 'eu-west-1');
    placed(db, 'in us-east-1', 'c1', 'us-east-1');
    placed(db, 'another account', 'c2', 'eu-west-1');

    expect(hostsInEnvironment(db, 'c1', 'eu-west-1', NOW).map((host) => host.name)).toEqual(['in eu-west-1']);
  });

  it('leaves out a machine nothing has placed, rather than guessing at one', () => {
    const db = createTestDb();
    placed(db, 'unplaced', null, null);
    // Placed in an account but never in a region: half an answer, and not one a scoped page can use.
    placed(db, 'account only', 'c1', null);

    expect(hostsInEnvironment(db, 'c1', 'eu-west-1', NOW)).toEqual([]);
  });

  it('carries the last reading, so the page states a figure rather than a verdict', () => {
    const db = createTestDb();
    const host = placed(db, 'reporting', 'c1', 'eu-west-1');
    recordReport(db, { hostId: host.id, identity: identity(), sample: sample({ cpuPercent: 42 }), atMs: NOW });

    const [found] = hostsInEnvironment(db, 'c1', 'eu-west-1', NOW);
    expect(found.latest?.cpuPercent).toBe(42);
  });
});
