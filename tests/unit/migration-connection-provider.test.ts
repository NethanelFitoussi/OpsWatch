import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 0036, which rebuilds `connections` — the parent of nineteen cascading children.
 *
 * This is the migration in this product with the most to lose. `connections` gains a provider and
 * `aws_account_id` becomes nullable, which SQLite can only do by building a new table, dropping the old
 * one and renaming. Every problem, alert, error group, log source, deployment and history point
 * references `connections` with `ON DELETE CASCADE`, so if foreign keys are enforced while that `DROP
 * TABLE` runs, the migration deletes the operator's entire history and reports success.
 *
 * `PRAGMA foreign_keys` is a no-op inside a transaction, and a migrator that wraps each file in one
 * would therefore leave them on. So this runs the real migrator against a database that has children in
 * it, rather than executing the statements by hand — the question is not what the SQL says, it is what
 * the application does with it.
 */

import { cpSync, mkdtempSync, readFileSync as read, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const DRIZZLE = join(__dirname, '../../drizzle');
const MIGRATION = '0036_connection_provider';

/**
 * A copy of the migrations folder holding only those up to `upTo`, journal included.
 *
 * The real upgrade path, rather than an approximation of it: an installation sits at 0035 because that
 * is the last release it ran, then pulls one that contains 0036 and starts. Running the statements by
 * hand would prove what the SQL says; running the migrator proves what the application does with it,
 * and the difference between those two is whether `PRAGMA foreign_keys=OFF` takes effect at all.
 */
function folderUpTo(upTo: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'opswatch-migrations-'));
  cpSync(DRIZZLE, dir, { recursive: true });
  if (upTo !== null) {
    const journal = JSON.parse(read(join(dir, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] };
    journal.entries = journal.entries.filter((entry) => entry.tag < upTo);
    writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify(journal));
  }
  return dir;
}

/** A database migrated to 0035 by the real migrator, with rows in the tables that cascade. */
function beforeMigration(): Database.Database {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const older = folderUpTo(MIGRATION);
  migrate(drizzle({ client: sqlite }), { migrationsFolder: older });
  rmSync(older, { recursive: true, force: true });

  sqlite
    .prepare('insert into connections (id,name,method,aws_account_id,regions,status,created_at,updated_at) values (?,?,?,?,?,?,?,?)')
    .run('conn-a', 'prod', 'role', '111122223333', '["eu-west-1"]', 'ok', 1, 1);
  sqlite
    .prepare(
      `insert into problems (id,key,connection_id,scope,kind,subject_type,subject_id,subject_name,source,title_key,"values",
        severity,score,score_terms,status,href,first_seen_at,last_seen_at,last_evaluated_at)
       values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run('p1', 'k1', 'conn-a', 'eu-west-1', 'ecs_cpu_high', 'service', 's1', 'web', 'detector', 'Insights.messages.x', '{}', 'critical', 10, '{}', 'open', '/x', 1, 1, 1);
  sqlite
    .prepare('insert into log_sources (id,connection_id,scope,log_group,enabled,format,field_map,created_at) values (?,?,?,?,?,?,?,?)')
    .run('ls1', 'conn-a', 'eu-west-1', '/aws/ecs/web', 1, 'json', '{}', 1);
  return sqlite;
}

/** Runs the pending migrations exactly as `createDb` does, from the full folder. */
function applyWithRealMigrator(sqlite: Database.Database) {
  // Including the part that makes a rebuild survivable, which is outside the migrator's transaction.
  sqlite.pragma('foreign_keys = OFF');
  try {
    migrate(drizzle({ client: sqlite }), { migrationsFolder: DRIZZLE });
  } finally {
    sqlite.pragma('foreign_keys = ON');
  }
}

describe('0036 — a provider on the connection, without losing the estate', () => {
  it('THE RULING: rebuilding `connections` does not cascade away everything that references it', () => {
    const db = beforeMigration();
    expect(db.prepare('select count(*) as n from problems').get()).toEqual({ n: 1 });

    applyWithRealMigrator(db);

    // The rows that would have gone silently, and the migration would have reported success.
    expect(db.prepare('select count(*) as n from problems').get()).toEqual({ n: 1 });
    expect(db.prepare('select count(*) as n from log_sources').get()).toEqual({ n: 1 });
    expect(db.prepare('select count(*) as n from connections').get()).toEqual({ n: 1 });
  });

  it('calls every connection that already exists an AWS one, because that is what they are', () => {
    const db = beforeMigration();
    applyWithRealMigrator(db);

    expect(db.prepare("select provider, aws_account_id, gcp_project_id from connections where id = 'conn-a'").get()).toEqual({
      provider: 'aws',
      aws_account_id: '111122223333',
      gcp_project_id: null,
    });
  });

  it('lets a connection to another cloud have no AWS account, which is the point of the change', () => {
    const db = beforeMigration();
    applyWithRealMigrator(db);

    expect(() =>
      db
        .prepare(
          'insert into connections (id,name,provider,method,aws_account_id,regions,gcp_project_id,status,created_at,updated_at) values (?,?,?,?,?,?,?,?,?,?)',
        )
        .run('conn-g', 'analytics', 'gcp', 'federation', null, '[]', 'my-project', 'draft', 1, 1),
    ).not.toThrow();
  });

  it('keeps the child foreign keys, so a connection deleted afterwards still takes its rows', () => {
    /*
     * The rebuild must not leave the children pointing at a table that no longer exists. `problems` and
     * the eighteen like it carry a plain `connection_id` with no foreign key — which is the whole
     * reason `purgeConnectionData` exists — so the one to check is a table that really does cascade.
     */
    const db = beforeMigration();
    db.prepare(
      'insert into aws_collection (connection_id, managed, realtime_logs, persist_logs, retention_hours, created_at, updated_at) values (?,?,?,?,?,?,?)',
    ).run('conn-a', 1, 1, 0, 24, 1, 1);
    applyWithRealMigrator(db);
    db.pragma('foreign_keys = ON');

    expect(db.prepare('select count(*) as n from aws_collection').get()).toEqual({ n: 1 });
    db.prepare("delete from connections where id = 'conn-a'").run();
    expect(db.prepare('select count(*) as n from aws_collection').get()).toEqual({ n: 0 });
  });
});
