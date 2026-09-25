import { describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { hosts as schemaHosts } from '@/lib/db/schema';
import { getTableName } from 'drizzle-orm';
import { PURGED_TABLES, purgeConnectionData } from '@/lib/store/connection-data';
import { insertProblem } from '@/lib/store/problems';
import { appendEvent } from '@/lib/store/events';
import { finishRun, startRun } from '@/lib/store/collector';
import { upsertCheck } from '@/lib/store/synthetics';
import { recordFamilySnapshot } from '@/lib/store/health';
import { createDestination, findDestination } from '@/lib/store/notifications';
import { createHost, findHost } from '@/lib/store/hosts';
import { createTestDb } from '../helpers/db';
import { newProblem } from '../helpers/detect';

/**
 * Disconnecting an AWS account takes its data with it.
 *
 * Four tables cascade from `connections`; the other nineteen carry a plain `connection_id`, so deleting
 * the connection row used to leave every problem, alert, error group, deployment, log source, saved
 * search and history point that account produced in the database for ever — unreachable through any
 * page, because every page is scoped, but still counted by the instance-wide reads and still holding
 * data for an account the operator had explicitly disconnected.
 */

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const MINE = 'c1';
const THEIRS = 'c2';
const scope = 'us-east-1';

/** Table names in the live schema that carry a `connection_id`, read from SQLite rather than listed. */
function tablesWithConnectionId(db: ReturnType<typeof createTestDb>): string[] {
  const names = db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%'`);
  return names
    .map((row) => row.name)
    .filter((name) => db.all<{ name: string }>(sql.raw(`pragma table_info('${name}')`)).some((column) => column.name === 'connection_id'))
    .sort();
}

function seed(db: ReturnType<typeof createTestDb>, connectionId: string) {
  insertProblem(db, newProblem({ key: `k-${connectionId}`.padEnd(32, 'x'), connectionId, scope, firstSeenAt: NOW, lastSeenAt: NOW, lastEvaluatedAt: NOW }));
  appendEvent(db, {
    at: NOW, connectionId, scope, kind: 'problem_opened', subjectType: 'service', subjectId: 'prod/web',
    serviceId: 'prod/web', severity: null, source: 'aws', payload: {}, dedupeKey: `e-${connectionId}`,
  });
  upsertCheck(db, { connectionId, scope, name: `check-${connectionId}`, url: 'https://example.com/healthz', enabled: true, assertions: [] }, NOW);
  recordFamilySnapshot(db, { connectionId, scope, family: 'ecs', status: 'healthy', total: 1, affected: 0, readAt: NOW, unavailableReason: null, unavailableCode: null });
  const run = startRun(db, { job: 'detect', connectionId, scope, startedAt: NOW });
  finishRun(db, run.id, { finishedAt: NOW + 10, status: 'ok' });
}

/** How many rows in the whole database carry this connection id, whatever table they are in. */
function rowsFor(db: ReturnType<typeof createTestDb>, connectionId: string): number {
  return tablesWithConnectionId(db).reduce((total, table) => {
    const [row] = db.all<{ n: number }>(sql.raw(`select count(*) as n from "${table}" where connection_id = '${connectionId}'`));
    return total + (row?.n ?? 0);
  }, 0);
}

describe('removing everything one connection wrote', () => {
  it('THE RULING: nothing of the disconnected account is left anywhere', () => {
    const db = createTestDb();
    seed(db, MINE);
    expect(rowsFor(db, MINE)).toBeGreaterThan(0);

    purgeConnectionData(db, MINE);
    expect(rowsFor(db, MINE)).toBe(0);
  });

  it('THE RULING: the other account is untouched', () => {
    // The whole point of the feature is that two accounts live in one installation. A purge that took
    // the wrong rows would be worse than the leak it replaced.
    const db = createTestDb();
    seed(db, MINE);
    seed(db, THEIRS);
    const before = rowsFor(db, THEIRS);

    purgeConnectionData(db, MINE);
    expect(rowsFor(db, THEIRS)).toBe(before);
    expect(rowsFor(db, MINE)).toBe(0);
  });

  it('takes the children of what it deletes, leaving no history nobody can attribute', () => {
    const db = createTestDb();
    seed(db, MINE);
    purgeConnectionData(db, MINE);
    // `problem_evidence`, `synthetic_runs` and the rest cascade from their parents; none may survive.
    for (const table of ['problem_evidence', 'synthetic_runs', 'error_occurrences', 'incident_timeline']) {
      const [row] = db.all<{ n: number }>(sql.raw(`select count(*) as n from "${table}"`));
      expect(row?.n ?? 0, table).toBe(0);
    }
  });

  it('THE RULING: it unscopes the operator’s webhook rather than deleting it', () => {
    /*
     * A destination carries a signing secret that was shown once and can never be read again. Deleting
     * the connection it was scoped to must not take it: the operator would lose an endpoint they set up,
     * silently, as a side effect of disconnecting an account.
     */
    const db = createTestDb();
    const { destination } = createDestination(db, { name: 'client-b', url: 'https://example.com/hook', connectionId: MINE }, 'secret'.padEnd(32, 'x'), NOW);

    purgeConnectionData(db, MINE);
    const after = findDestination(db, destination.id);
    expect(after).not.toBeNull();
    // It now receives everything, which is visible on the page and the operator's to change.
    expect(after?.connectionId).toBeNull();
  });

  it('THE RULING: it unlinks a Linux host rather than deleting the machine’s readings', () => {
    /*
     * A host is a machine. It exists whether or not anybody is watching the AWS account it happens to
     * run in, and its agent keeps reporting either way. Deleting it because an AWS connection went away
     * would destroy readings from a machine nobody disconnected.
     */
    const db = createTestDb();
    const { host } = createHost(db, { name: 'api-prod-03', nowMs: NOW }, 'secret'.padEnd(32, 'x'));
    db.update(schemaHosts).set({ connectionId: MINE }).where(eq(schemaHosts.id, host.id)).run();

    purgeConnectionData(db, MINE);
    const after = findHost(db, host.id);
    expect(after).not.toBeNull();
    expect(after?.connectionId).toBeNull();
  });

  it('leaves an instance-wide row alone, because it belongs to no connection', () => {
    const db = createTestDb();
    const run = startRun(db, { job: 'compact', connectionId: null, scope: null, startedAt: NOW });
    finishRun(db, run.id, { finishedAt: NOW + 10, status: 'ok' });

    purgeConnectionData(db, MINE);
    const [row] = db.all<{ n: number }>(sql.raw(`select count(*) as n from collector_runs where connection_id is null`));
    expect(row?.n).toBe(1);
  });

  it('THE RULING: a table added later cannot quietly start leaking', () => {
    /*
     * The list in `purgeConnectionData` is held against the live schema rather than trusted. A new
     * table with a `connection_id` that nobody adds to the purge fails here, on the day it is added,
     * instead of leaving rows behind on every disconnect from then on.
     *
     * Compared as sets rather than by inserting rows: a crude insert can fail a foreign key and leave
     * the table empty, and an empty table passes every check by accident.
     */
    const db = createTestDb();
    const inSchema = tablesWithConnectionId(db);
    const purged: string[] = PURGED_TABLES.map((table) => getTableName(table)).sort();

    // The ingestion tables cascade from `aws_collection`, which the purge does name.
    const cascading = ['aws_forwarded_groups', 'ingest_events', 'ingest_stats'];
    // Two tables are deliberately unlinked rather than emptied, because neither is the connection's to
    // destroy: a destination is the operator's own webhook with a secret shown once, and a host is a
    // machine that exists whether or not anybody watches the AWS account it runs in.
    const unscoped = ['notify_destinations', 'hosts'];
    expect(inSchema.filter((name) => !purged.includes(name) && !cascading.includes(name) && !unscoped.includes(name))).toEqual([]);
    // And nothing is purged that the schema does not have, which would be a rename nobody finished.
    expect(purged.filter((name) => !inSchema.includes(name))).toEqual([]);
  });
});
