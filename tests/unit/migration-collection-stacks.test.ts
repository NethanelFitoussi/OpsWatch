import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 0035, applied to an account that already has a forwarder installed.
 *
 * The collection stack moves out of `aws_collection`, which held one per account, into a row per
 * region. drizzle-kit generated the move as six `DROP COLUMN`s and nothing else: on any installation
 * with a forwarder, the stack name, the stack id and the ARN would simply have gone — leaving OpsWatch
 * unable to name the stack it asks the operator to delete, and unable to forward anything until they
 * installed it again.
 *
 * Which region the existing stack belongs to is not a guess. `startForwarding` read one `forwarder_arn`
 * for the whole account, and the page said it forwarded from the connection's first region, so that is
 * the only region it could have been forwarding from.
 */

const DRIZZLE = join(__dirname, '../../drizzle');
const MIGRATION = '0035_collection_stacks_per_region.sql';

function exec(db: Database.Database, file: string) {
  for (const statement of readFileSync(join(DRIZZLE, file), 'utf8').split('--> statement-breakpoint')) {
    if (statement.trim() !== '') db.exec(statement);
  }
}

/** A database at 0034, with one account forwarding and one that never installed anything. */
function beforeMigration(): Database.Database {
  const db = new Database(':memory:');
  for (const file of readdirSync(DRIZZLE).filter((name) => name.endsWith('.sql')).sort()) {
    if (file === MIGRATION) break;
    exec(db, file);
  }
  const connection = db.prepare(
    'insert into connections (id,name,method,aws_account_id,regions,status,created_at,updated_at) values (?,?,?,?,?,?,?,?)',
  );
  connection.run('conn-a', 'prod', 'role', '111122223333', '["eu-west-1","us-east-1"]', 'connected', 1, 1);
  connection.run('conn-b', 'staging', 'role', '444455556666', '["eu-west-1"]', 'connected', 1, 1);

  const collection = db.prepare(
    `insert into aws_collection (connection_id, managed, realtime_logs, persist_logs, retention_hours,
      ingest_secret_ciphertext, secret_rotated_at, stack_state, stack_name, stack_id, forwarder_arn,
      forwarder_version, verified_at, created_at, updated_at)
     values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  collection.run('conn-a', 1, 1, 0, 24, 'cipher', 5, 'verified', 'opswatch-a-collection', 'arn:aws:cloudformation:eu-west-1:…', 'arn:aws:lambda:eu-west-1:…', '1.2.0', 7, 1, 2);
  // Consent given, nothing installed: there is no stack to carry anywhere.
  collection.run('conn-b', 1, 0, 0, 24, 'cipher', 5, 'absent', null, null, null, null, null, 1, 2);
  return db;
}

const stacks = (db: Database.Database) =>
  db.prepare('select * from aws_collection_stacks order by connection_id, region').all() as Record<string, unknown>[];

describe('0035 — the collection stack becomes a thing in a region', () => {
  it('THE RULING: an installed forwarder survives the move, under the region it was forwarding from', () => {
    const db = beforeMigration();
    expect(() => exec(db, MIGRATION)).not.toThrow();

    expect(stacks(db)).toEqual([
      {
        connection_id: 'conn-a',
        region: 'eu-west-1',
        stack_state: 'verified',
        stack_name: 'opswatch-a-collection',
        stack_id: 'arn:aws:cloudformation:eu-west-1:…',
        forwarder_arn: 'arn:aws:lambda:eu-west-1:…',
        forwarder_version: '1.2.0',
        verified_at: 7,
        created_at: 1,
        updated_at: 2,
      },
    ]);
  });

  it('writes no row for an account that never installed one, because absent is the absence of a row', () => {
    const db = beforeMigration();
    exec(db, MIGRATION);
    expect(stacks(db).filter((row) => row.connection_id === 'conn-b')).toEqual([]);
  });

  it('leaves the consent behind, which is the half that belongs to the account', () => {
    const db = beforeMigration();
    exec(db, MIGRATION);

    const row = db.prepare("select * from aws_collection where connection_id = 'conn-a'").get() as Record<string, unknown>;
    expect(row).toMatchObject({ managed: 1, realtime_logs: 1, ingest_secret_ciphertext: 'cipher' });
    // …and the stack columns are gone from it, so there is one place to read a forwarder from.
    expect(Object.keys(row)).not.toContain('forwarder_arn');
  });

  it('lets one account hold a stack in every region it reads', () => {
    const db = beforeMigration();
    exec(db, MIGRATION);
    const insert = db.prepare(
      'insert into aws_collection_stacks (connection_id, region, stack_state, created_at, updated_at) values (?,?,?,?,?)',
    );
    expect(() => insert.run('conn-a', 'us-east-1', 'verified', 1, 1)).not.toThrow();
    // …and only one per region, which is what makes "this region's forwarder" a single answer.
    expect(() => insert.run('conn-a', 'us-east-1', 'verified', 1, 1)).toThrow();
  });
});
