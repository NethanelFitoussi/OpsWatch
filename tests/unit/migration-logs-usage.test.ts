import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 0032, applied to a database that already has spend in it.
 *
 * `logs_usage` was keyed by the UTC day alone, so the rows an installation already has carry no account.
 * drizzle-kit generates this kind of rebuild by selecting every column of the new table out of the old
 * one — including the column that does not exist yet, which would have failed on the first `docker
 * compose up` of every installation that has ever collected an error. A migration is only as good as the
 * database it is run against, so this runs it against one.
 *
 * What it must do with rows nobody can attribute is the other half: on an installation with exactly one
 * connection the answer is known and is written down; with none or with several it is not, and the rows
 * are kept unattributed rather than deleted or guessed at.
 */

const DRIZZLE = join(__dirname, '../../drizzle');
const MIGRATION = '0032_logs_usage_per_connection.sql';

function exec(db: Database.Database, file: string) {
  for (const statement of readFileSync(join(DRIZZLE, file), 'utf8').split('--> statement-breakpoint')) {
    if (statement.trim() !== '') db.exec(statement);
  }
}

/** A database as it stood at 0031, with two days of real spend recorded against no account. */
function beforeMigration(connectionIds: string[]): Database.Database {
  const db = new Database(':memory:');
  for (const file of readdirSync(DRIZZLE).filter((name) => name.endsWith('.sql')).sort()) {
    if (file === MIGRATION) break;
    exec(db, file);
  }
  const usage = db.prepare('insert into logs_usage (day, bytes_scanned, queries, stopped_at) values (?,?,?,?)');
  usage.run(1_000_000_000_000, 42, 3, null);
  usage.run(1_000_086_400_000, 7, 1, 5);
  const connection = db.prepare(
    'insert into connections (id,name,method,aws_account_id,regions,status,created_at,updated_at) values (?,?,?,?,?,?,?,?)',
  );
  for (const id of connectionIds) connection.run(id, id, 'role', '111122223333', '["eu-west-1"]', 'connected', 1, 1);
  return db;
}

const rows = (db: Database.Database) => db.prepare('select * from logs_usage order by day').all() as Record<string, unknown>[];

describe('0032 — the log budget gains an account', () => {
  it('THE RULING: it applies to a database that already has spend, and loses none of it', () => {
    const db = beforeMigration(['conn-a']);
    expect(() => exec(db, MIGRATION)).not.toThrow();

    expect(rows(db)).toEqual([
      { day: 1_000_000_000_000, connection_id: 'conn-a', bytes_scanned: 42, queries: 3, stopped_at: null },
      { day: 1_000_086_400_000, connection_id: 'conn-a', bytes_scanned: 7, queries: 1, stopped_at: 5 },
    ]);
  });

  it('keeps spend it cannot attribute rather than deleting it or guessing', () => {
    for (const connections of [[], ['conn-a', 'conn-b']]) {
      const db = beforeMigration(connections);
      exec(db, MIGRATION);
      expect(rows(db).map((row) => [row.connection_id, row.bytes_scanned])).toEqual([
        ['', 42],
        ['', 7],
      ]);
    }
  });

  it('keys the table by day and account, so two accounts can spend on the same day', () => {
    const db = beforeMigration(['conn-a']);
    exec(db, MIGRATION);
    const insert = db.prepare('insert into logs_usage (day, connection_id, bytes_scanned, queries, stopped_at) values (?,?,?,?,?)');
    expect(() => insert.run(2_000_000_000_000, 'conn-a', 1, 1, null)).not.toThrow();
    expect(() => insert.run(2_000_000_000_000, 'conn-b', 1, 1, null)).not.toThrow();
    // …and still only once each, which is what makes the running total a total.
    expect(() => insert.run(2_000_000_000_000, 'conn-a', 1, 1, null)).toThrow();
  });
});
