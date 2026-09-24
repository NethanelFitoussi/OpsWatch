import { describe, expect, it } from 'vitest';
import { createConnection } from '@/lib/connections/repository';
import { INGEST_BATCH, isForwarded, runIngestJob } from '@/lib/collector/ingest-job';
import { ingestEventId } from '@/lib/ingest/identity';
import {
  dueIngestEvents,
  storeIngestEvents,
  upsertForwardedGroup,
  writeCollection,
} from '@/lib/store/collection';
import { listLogSources, recentErrorGroups } from '@/lib/store/errors';
import { createTestDb } from '../helpers/db';

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);
const HOUR = 60 * 60_000;
const REGION = 'eu-west-1';
const GROUP = '/aws/ecs/api';

const ready = (over: { persistLogs?: boolean; retentionHours?: number } = {}) => {
  const db = createTestDb();
  const connection = createConnection(db, { name: 'prod', method: 'role', awsAccountId: '123456789012', regions: [REGION] });
  writeCollection(db, connection.id, { managed: true, realtimeLogs: true, persistLogs: over.persistLogs ?? false, retentionHours: over.retentionHours ?? 24 }, NOW);
  upsertForwardedGroup(db, { connectionId: connection.id, region: REGION, logGroup: GROUP, filterName: 'OpsWatch-x', state: 'active', lastError: null }, NOW);
  return { db, connectionId: connection.id };
};

const deliver = (db: ReturnType<typeof createTestDb>, connectionId: string, messages: string[], atMs = NOW, offset = 0) =>
  storeIngestEvents(
    db,
    messages.map((message, index) => ({
      id: ingestEventId({ awsAccountId: '123456789012', region: REGION, logGroup: GROUP, logStream: 's', eventId: String(offset + index) }),
      connectionId,
      region: REGION,
      source: 'aws.logs',
      logGroup: GROUP,
      logStream: 's',
      at: atMs,
      message,
      receivedAt: atMs,
    })),
  );

describe('draining what a forwarder delivered', () => {
  it('THE RULING: a pushed line and a pulled line become the same kind of error group', () => {
    const { db, connectionId } = ready();
    deliver(db, connectionId, ['TypeError: cannot read properties of undefined']);

    expect(runIngestJob({ db, nowMs: NOW })).toMatchObject({ covered: 1 });
    // The same parser the `errors` job uses, so push is a cheaper way to get the same lines rather than a
    // second, parallel idea of what an error is.
    const groups = recentErrorGroups(db, { connectionId, scope: REGION, sinceMs: NOW - HOUR }, 10);
    expect(groups).toHaveLength(1);
    expect(groups[0].sampleMessage).toContain('cannot read properties of undefined');
  });

  it('creates a parked log source for a group nobody configured, so the pull job never queries it', () => {
    const { db, connectionId } = ready();
    deliver(db, connectionId, ['boom']);
    runIngestJob({ db, nowMs: NOW });

    const [source] = listLogSources(db, connectionId, REGION);
    expect(source.logGroup).toBe(GROUP);
    // Disabled: the `errors` job skips it, so an operator is not billed per gigabyte for lines that
    // already arrived for free.
    expect(source.enabled).toBe(false);
  });

  it('THE RULING: a forwarded group is not also queried through Logs Insights', () => {
    const { db, connectionId } = ready();
    expect(isForwarded(db, connectionId, REGION, GROUP)).toBe(true);
    // Not forwarded: a different group, or the same one once forwarding is switched off.
    expect(isForwarded(db, connectionId, REGION, '/aws/ecs/other')).toBe(false);
    writeCollection(db, connectionId, { realtimeLogs: false }, NOW);
    expect(isForwarded(db, connectionId, REGION, GROUP)).toBe(false);
  });

  it('does nothing, cheaply, when nothing has been delivered', () => {
    const { db } = ready();
    expect(runIngestJob({ db, nowMs: NOW })).toEqual({ covered: 0, total: 0, truncated: false });
  });

  it('is bounded, so a burst cannot make one pass unbounded', () => {
    const { db, connectionId } = ready();
    deliver(db, connectionId, Array.from({ length: INGEST_BATCH + 10 }, (_, i) => `line ${i}`));
    const outcome = runIngestJob({ db, nowMs: NOW });
    expect(outcome.covered).toBe(INGEST_BATCH);
    expect(outcome.truncated).toBe(true);
  });
});

describe('THE RULING: nothing is kept that nobody asked to keep', () => {
  it('discards a record in the same pass that processed it, when persistence is off', () => {
    const { db, connectionId } = ready({ persistLogs: false });
    deliver(db, connectionId, ['boom']);
    runIngestJob({ db, nowMs: NOW });

    // It existed only long enough to be read. The error group it produced survives; the log line does not.
    expect(dueIngestEvents(db, 10)).toEqual([]);
    expect(db.$client.prepare('select count(*) as n from ingest_events').get()).toEqual({ n: 0 });
    expect(recentErrorGroups(db, { connectionId, scope: REGION, sinceMs: NOW - HOUR }, 10)).toHaveLength(1);
  });

  it('keeps a record until the retention edge, when persistence is on', () => {
    const { db, connectionId } = ready({ persistLogs: true, retentionHours: 2 });
    deliver(db, connectionId, ['boom']);
    runIngestJob({ db, nowMs: NOW });
    expect(db.$client.prepare('select count(*) as n from ingest_events').get()).toEqual({ n: 1 });

    // One hour later it is still inside the window; three hours later it is not.
    runIngestJob({ db, nowMs: NOW + HOUR });
    expect(db.$client.prepare('select count(*) as n from ingest_events').get()).toEqual({ n: 1 });
    runIngestJob({ db, nowMs: NOW + 3 * HOUR });
    expect(db.$client.prepare('select count(*) as n from ingest_events').get()).toEqual({ n: 0 });
  });

  it('never sweeps something it has not processed', () => {
    const { db, connectionId } = ready({ persistLogs: false });
    deliver(db, connectionId, ['boom']);
    // The sweep runs on every pass, including the one that drains — and a record queued after it would
    // still be there for the next.
    deliver(db, connectionId, ['second'], NOW, 100);
    expect(dueIngestEvents(db, 10)).toHaveLength(2);
  });
});
