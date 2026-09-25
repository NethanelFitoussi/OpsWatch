import { describe, expect, it, vi } from 'vitest';

const SECRET = 'test-secret'.padEnd(32, 'x');
vi.mock('@/lib/env', () => ({ env: () => ({ OPSWATCH_SECRET: SECRET, OPSWATCH_PUBLIC_URL: 'https://opswatch.example' }) }));

import { eq } from 'drizzle-orm';
import { machineCandidates } from '@/lib/collector/machine-alerts';
import { runAlertCycle } from '@/lib/collector/alerts';
import { MACHINE_KINDS, ruleMatches, type Candidate, type Rule } from '@/lib/detect/alert';
import { hosts as schemaHosts } from '@/lib/db/schema';
import { listAlerts } from '@/lib/store/alerts';
import { createDestination, dueDeliveries, setDestinationEnabled } from '@/lib/store/notifications';
import { createHost, recordReport } from '@/lib/store/hosts';
import { createTestDb } from '../helpers/db';

/**
 * Alerting on a machine.
 *
 * A disk could fill on the box running somebody's Redis and the only way to find out was to open the
 * Machines page. These tests are about the part that tells them — and about the two ways it could be
 * dishonest: alerting about a machine that is not in this environment, and alerting on a figure the
 * agent never measured.
 */

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const SECRET_KEY = 'instance-secret'.padEnd(32, 'x');
const env = { connectionId: 'c1', scope: 'eu-west-1' };

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

/** A machine placed in `env`, with one reading. */
function machine(db: ReturnType<typeof createTestDb>, name: string, over: Record<string, unknown> = {}, place = env) {
  const { host } = createHost(db, { name, nowMs: NOW }, SECRET_KEY);
  db.update(schemaHosts)
    .set({ connectionId: place.connectionId, region: place.scope })
    .where(eq(schemaHosts.id, host.id))
    .run();
  recordReport(db, { hostId: host.id, identity: identity({ machineId: name }), sample: sample(over), atMs: NOW });
  return host;
}

const FULL = { disks: [{ mount: '/', usedBytes: 49_000_000_000, totalBytes: 50_000_000_000 }] };

describe('what a machine contributes to the alert cycle', () => {
  it('THE RULING: a full disk on a placed machine becomes a candidate, with the figure behind it', () => {
    const db = createTestDb();
    const host = machine(db, 'redis-box', FULL);

    const [candidate] = machineCandidates(db, env, NOW);
    expect(candidate).toMatchObject({
      kind: 'disk_full',
      severity: 'critical',
      hostId: host.id,
      // Never a problem row: `problems` is keyed to an AWS environment by a column that cannot be null.
      problemId: null,
    });
    expect(candidate.values).toMatchObject({ name: 'redis-box', subject: '/', percent: '98' });
    // One alert per machine, kind and subject, and on the id rather than the name: renaming a machine
    // must not read as a new problem starting.
    expect(candidate.subjectKey).toBe(`host:${host.id}:disk_full:/`);
  });

  it('THE RULING: a machine in another environment contributes nothing to this one', () => {
    const db = createTestDb();
    machine(db, 'other-account', FULL, { connectionId: 'c2', scope: 'eu-west-1' });
    machine(db, 'other-region', FULL, { connectionId: 'c1', scope: 'us-east-1' });

    expect(machineCandidates(db, env, NOW)).toEqual([]);
  });

  it('says nothing about a machine nothing has placed', () => {
    const db = createTestDb();
    const { host } = createHost(db, { name: 'unplaced', nowMs: NOW }, SECRET_KEY);
    recordReport(db, { hostId: host.id, identity: identity(), sample: sample(FULL), atMs: NOW });

    expect(machineCandidates(db, env, NOW)).toEqual([]);
  });

  it('says nothing about a healthy machine, and nothing about one that has never reported', () => {
    const db = createTestDb();
    machine(db, 'fine');
    const { host } = createHost(db, { name: 'waiting', nowMs: NOW }, SECRET_KEY);
    db.update(schemaHosts).set({ connectionId: env.connectionId, region: env.scope }).where(eq(schemaHosts.id, host.id)).run();

    // "Waiting for its first report" is not a finding: there is nothing to have found (§2.6).
    expect(machineCandidates(db, env, NOW)).toEqual([]);
  });

  it('every kind it can raise belongs to the machine condition, and to no other', () => {
    // The conditions partition the space. A kind in two of them would be announced twice under
    // different names, which is how an operator ends up muting both.
    const rule = (condition: Rule['condition']): Rule => ({
      id: 'r',
      enabled: true,
      condition,
      minSeverity: 'warning',
      kinds: [],
      cooldownSeconds: 0,
    });
    for (const kind of MACHINE_KINDS) {
      const candidate: Candidate = { subjectKey: 's', kind, severity: 'critical', problemId: null, titleKey: 't', values: {} };
      expect(ruleMatches(rule('machine'), candidate), kind).toBe(true);
      for (const other of ['problem', 'synthetic', 'slo'] as const) {
        expect(ruleMatches(rule(other), candidate), `${kind} as ${other}`).toBe(false);
      }
    }
  });
});

describe('a machine alert, end to end through the cycle', () => {
  it('THE RULING: it opens, it is delivered, and it points at the machine rather than at a problem', () => {
    const db = createTestDb();
    const host = machine(db, 'redis-box', FULL);
    const destination = createDestination(db, { name: 'ops', url: 'https://example.invalid/hook' }, SECRET, NOW);
    setDestinationEnabled(db, destination.destination.id, true);

    const result = runAlertCycle(db, env, [], NOW);
    expect(result.opened).toBe(1);

    const [alert] = listAlerts(db, env.connectionId, env.scope, 10);
    expect(alert).toMatchObject({ severity: 'critical', problemId: null });

    const [delivery] = dueDeliveries(db, NOW + 1000, 10);
    // The machine's own page. Without this branch the one alert most worth acting on would land the
    // operator on a list of every alert there is.
    const payload = delivery.payload as { url: string; title: string };
    expect(payload.url).toBe(`https://opswatch.example/hosts/${host.id}`);
    // The key, not a rendered sentence: a receiver in another language renders it itself.
    expect(payload.title).toBe('Insights.messages.machine_disk_full');
  });

  it('raises one alert however many cycles run, and resolves it when the disk is emptied', () => {
    const db = createTestDb();
    const host = machine(db, 'redis-box', FULL);

    expect(runAlertCycle(db, env, [], NOW).opened).toBe(1);
    expect(runAlertCycle(db, env, [], NOW + 60_000).opened).toBe(0);

    // The agent reports again with room on the disk: the finding goes, and so does the alert.
    recordReport(db, { hostId: host.id, identity: identity({ machineId: 'redis-box' }), sample: sample(), atMs: NOW + 120_000 });
    expect(runAlertCycle(db, env, [], NOW + 120_000).resolved).toBe(1);
  });
});
