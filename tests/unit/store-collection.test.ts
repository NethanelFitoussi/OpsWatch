import { describe, expect, it } from 'vitest';
import { createConnection } from '@/lib/connections/repository';
import { ingestEventId } from '@/lib/ingest/identity';
import {
  deleteForwardedGroup,
  deleteIngestEvents,
  dueIngestEvents,
  listForwardedGroups,
  listManagedConnections,
  markIngestProcessed,
  readCollection,
  readIngestTraffic,
  recordIngestStat,
  recordsThisMinute,
  storeIngestEvents,
  sweepIngestEvents,
  upsertForwardedGroup,
  writeCollection,
} from '@/lib/store/collection';
import { createTestDb } from '../helpers/db';

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);
const MINUTE = 60_000;

const withAccounts = () => {
  const db = createTestDb();
  const make = (name: string, account: string) =>
    createConnection(db, { name, method: 'role', awsAccountId: account, regions: ['eu-west-1'] }).id;
  return { db, one: make('one', '123456789012'), two: make('two', '210987654321') };
};

const record = (connectionId: string, over: Record<string, unknown> = {}) => ({
  id: ingestEventId({ connectionId, awsAccountId: '123456789012', region: 'eu-west-1', logGroup: '/g', logStream: '/s', eventId: '1', ...over }),
  connectionId,
  region: 'eu-west-1',
  source: 'aws.logs',
  logGroup: '/g',
  logStream: '/s',
  at: NOW,
  message: 'ERROR boom',
  receivedAt: NOW,
  ...over,
});

describe('THE RULING: absence is the default, and the default is everything off', () => {
  it('reads a connection nobody has configured as off, without writing a row', () => {
    const { db, one } = withAccounts();
    expect(readCollection(db, one)).toMatchObject({ managed: false, realtimeLogs: false, persistLogs: false, stackState: 'absent' });
    // Nothing was written, so nobody can mistake a default for a decision somebody made.
    expect(listManagedConnections(db)).toEqual([]);
  });

  it('keeps the three switches independent', () => {
    const { db, one } = withAccounts();
    writeCollection(db, one, { managed: true }, NOW);
    // Enabling forwarding says nothing about whether what arrives is kept.
    expect(readCollection(db, one)).toMatchObject({ managed: true, realtimeLogs: false, persistLogs: false });
    writeCollection(db, one, { realtimeLogs: true }, NOW);
    expect(readCollection(db, one)).toMatchObject({ managed: true, realtimeLogs: true, persistLogs: false });
  });

  it('separates what a browser said from what AWS answered', () => {
    const { db, one } = withAccounts();
    writeCollection(db, one, { stackState: 'declared', stackName: 'opswatch-x-collection' }, NOW);
    expect(readCollection(db, one).stackState).toBe('declared');
    writeCollection(db, one, { stackState: 'verified', forwarderArn: 'arn:aws:lambda:…', verifiedAt: NOW }, NOW);
    expect(readCollection(db, one)).toMatchObject({ stackState: 'verified', verifiedAt: NOW });
  });
});

describe('THE RULING: one account’s forwarder can never reach another account’s data', () => {
  it('keeps forwarded groups apart', () => {
    const { db, one, two } = withAccounts();
    upsertForwardedGroup(db, { connectionId: one, region: 'eu-west-1', logGroup: '/a', filterName: 'OpsWatch-one', state: 'active', lastError: null }, NOW);
    expect(listForwardedGroups(db, one)).toHaveLength(1);
    expect(listForwardedGroups(db, two)).toEqual([]);
    // And a delete aimed at the other account removes nothing.
    expect(deleteForwardedGroup(db, two, 'eu-west-1', '/a')).toBe(false);
    expect(listForwardedGroups(db, one)).toHaveLength(1);
  });

  it('keeps events apart, including their counters', () => {
    const { db, one, two } = withAccounts();
    storeIngestEvents(db, [record(one)]);
    recordIngestStat(db, one, 'eu-west-1', NOW, { events: 1, bytes: 10 });

    expect(dueIngestEvents(db, 10).map((row) => row.connectionId)).toEqual([one]);
    expect(readIngestTraffic(db, two, NOW - MINUTE)).toMatchObject({ events: 0, bytes: 0, lastEventAt: null });
    // Clearing one account's events leaves the other's alone.
    storeIngestEvents(db, [record(two, { eventId: '2' })]);
    expect(deleteIngestEvents(db, one)).toBe(1);
    expect(dueIngestEvents(db, 10).map((row) => row.connectionId)).toEqual([two]);
  });
});

describe('at-least-once delivery', () => {
  it('THE RULING: a replayed batch inserts nothing and is reported as recognised', () => {
    const { db, one } = withAccounts();
    expect(storeIngestEvents(db, [record(one)])).toEqual({ accepted: 1, duplicate: 0 });
    // A forwarder retrying something it already delivered should see that it was recognised, not a number
    // that looks like the work happened twice.
    expect(storeIngestEvents(db, [record(one)])).toEqual({ accepted: 0, duplicate: 1 });
    expect(dueIngestEvents(db, 10)).toHaveLength(1);
  });

  it('counts a partly-new batch honestly', () => {
    const { db, one } = withAccounts();
    storeIngestEvents(db, [record(one)]);
    expect(storeIngestEvents(db, [record(one), record(one, { eventId: '2' })])).toEqual({ accepted: 1, duplicate: 1 });
  });

  it('stores nothing for an empty batch', () => {
    const { db, one } = withAccounts();
    expect(storeIngestEvents(db, [])).toEqual({ accepted: 0, duplicate: 0 });
    void one;
  });
});

describe('THE RULING: nothing is retained that nobody asked to keep', () => {
  it('discards a processed event the moment it is processed, when persistence is off', () => {
    const { db, one } = withAccounts();
    storeIngestEvents(db, [record(one)]);
    const [queued] = dueIngestEvents(db, 10);
    markIngestProcessed(db, [queued.seq], NOW);
    // Persistence off: the sweep edge is now, so a processed row does not survive the cycle that made it.
    expect(sweepIngestEvents(db, one, NOW + 1)).toBe(1);
    expect(dueIngestEvents(db, 10)).toEqual([]);
  });

  it('never sweeps something still queued', () => {
    const { db, one } = withAccounts();
    storeIngestEvents(db, [record(one)]);
    // Unprocessed: sweeping it would lose a record nobody has looked at yet.
    expect(sweepIngestEvents(db, one, NOW + 10 * MINUTE)).toBe(0);
    expect(dueIngestEvents(db, 10)).toHaveLength(1);
  });

  it('keeps a processed event until the retention edge, when persistence is on', () => {
    const { db, one } = withAccounts();
    storeIngestEvents(db, [record(one)]);
    const [queued] = dueIngestEvents(db, 10);
    markIngestProcessed(db, [queued.seq], NOW);
    expect(sweepIngestEvents(db, one, NOW - MINUTE)).toBe(0);
    expect(sweepIngestEvents(db, one, NOW + MINUTE)).toBe(1);
  });
});

describe('the traffic behind forwarder health', () => {
  it('adds to the minute a request arrived in, and survives the events being discarded', () => {
    const { db, one } = withAccounts();
    recordIngestStat(db, one, 'eu-west-1', NOW, { events: 10, bytes: 1000 });
    recordIngestStat(db, one, 'eu-west-1', NOW + 30_000, { events: 5, bytes: 500, duplicates: 2 });
    recordIngestStat(db, one, 'eu-west-1', NOW + MINUTE, { rejected: 1 });

    const traffic = readIngestTraffic(db, one, NOW);
    expect(traffic).toMatchObject({ events: 15, bytes: 1500, duplicates: 2, rejected: 1 });
    // No event has been stored at all, and the counters still know what arrived.
    expect(dueIngestEvents(db, 10)).toEqual([]);
  });

  it('THE RULING: never having received anything is null, not a time', () => {
    const { db, one } = withAccounts();
    recordIngestStat(db, one, 'eu-west-1', NOW, { rejected: 3 });
    // Rejections are not arrivals: a forwarder that has only ever been refused has never delivered.
    expect(readIngestTraffic(db, one, NOW).lastEventAt).toBeNull();
  });

  it('counts every record an integration accounted for this minute, for the rate limit', () => {
    const { db, one } = withAccounts();
    // Accepted, refused and repeated together: all three cost something, and a client that is only ever
    // refused is still a client making this instance work.
    recordIngestStat(db, one, 'eu-west-1', NOW, { events: 4, rejected: 1, duplicates: 2 });
    expect(recordsThisMinute(db, one, NOW)).toBe(7);
    expect(recordsThisMinute(db, one, NOW + MINUTE)).toBe(0);
  });
});
