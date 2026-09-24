import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { env } from '../env';
import { appliedMigrations } from '../store/meta';
import { bundledMigrations, writeBackup } from './backup';
import * as schema from './schema';

/**
 * The database handle. `$client` is the better-sqlite3 connection drizzle wrapped, kept on the type because the
 * store layer needs statements drizzle does not express and the tests reach for it. Nothing above the store may
 * name it: `module-boundaries.test.ts` enforces that.
 */
export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

const MIGRATIONS_FOLDER = path.join(process.cwd(), 'drizzle');

export function createDb(filename: string): Db {
  if (filename !== ':memory:') {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }
  const sqlite = new Database(filename);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle({ client: sqlite, schema });
  if (filename !== ':memory:') backupBeforeMigrating(db, path.dirname(filename));
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

/**
 * One file copy in front of a schema change (HIS-10).
 *
 * Only when a migration is genuinely pending, and only when the database already holds something: a
 * first run has nothing to lose and would otherwise get an empty backup on every fresh install. A
 * failure here is logged and never fatal — refusing to start because a backup could not be written
 * would turn a full disk into an outage, and the migration itself is what the operator needs to happen.
 */
function backupBeforeMigrating(db: Db, dataDir: string): void {
  const applied = appliedMigrations(db);
  const bundled = bundledMigrations(MIGRATIONS_FOLDER);
  if (applied === null || applied === 0 || bundled === null || applied >= bundled) return;
  try {
    const backup = writeBackup(db, dataDir, Date.now(), 'migration');
    console.info(`[opswatch] backed up before migrating: ${path.join(dataDir, 'backups', backup.name)}`);
  } catch (error) {
    console.warn('[opswatch] could not write a pre-migration backup:', error instanceof Error ? error.name : 'unknown');
  }
}

let instance: Db | undefined;

export function getDb(): Db {
  instance ??= createDb(path.join(env().OPSWATCH_DATA_DIR, 'opswatch.sqlite'));
  return instance;
}
