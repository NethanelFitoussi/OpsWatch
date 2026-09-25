import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/client';
import { backupsDir, bundledMigrations, listBackups, type Backup } from '../db/backup';
import { describeStorage, type StorageFacts } from '../db/storage';
import { appliedMigrations } from '../store/meta';

/**
 * Where OpsWatch keeps what it has collected, and whether that is safe (§F).
 *
 * Every fact here was already somewhere — the schema version on System status, the data directory on
 * the backup page, the history switch on its own page — and an operator asking "where is my data and
 * will I lose it" had to visit three pages and join them up. This reads them once.
 *
 * Two things it refuses to do:
 *
 *   - **Guess.** A size that cannot be measured, a filesystem that cannot be read and a schema version
 *     that cannot be counted are all `null`, never zero and never "unknown, probably fine".
 *   - **Offer a storage backend that does not exist.** There is one place OpsWatch stores history: this
 *     file. A page listing "External PostgreSQL" or "AWS" as choices would be claiming support nobody
 *     has written, and a self-hosted operator would plan around it.
 */

export type SchemaState = {
  /** Migrations this database has had applied, or `null` when the journal cannot be read. */
  applied: number | null;
  /** Migrations this build carries, or `null` when its journal cannot be read. */
  bundled: number | null;
  /**
   * How many are waiting. `null` when either side is unknown — "cannot tell" is not "none pending",
   * and the page says which it is.
   */
  pending: number | null;
};

export type StorageState = {
  where: StorageFacts;
  /** The database file's size in bytes, or `null` when it cannot be measured. */
  bytes: number | null;
  schema: SchemaState;
  backups: Backup[];
  /** The backup taken in front of the last schema change, if one was. */
  lastMigrationBackup: Backup | null;
};

export function readStorageState(db: Db, input: { dataDir: string; migrationsFolder: string }): StorageState {
  const applied = appliedMigrations(db);
  const bundled = bundledMigrations(input.migrationsFolder);
  const backups = listBackups(backupsDir(input.dataDir));

  return {
    where: describeStorage(input.dataDir),
    bytes: fileBytes(path.join(input.dataDir, 'opswatch.sqlite')),
    schema: {
      applied,
      bundled,
      // Both halves or nothing: one unknown side makes the difference unknowable.
      pending: applied === null || bundled === null ? null : Math.max(0, bundled - applied),
    },
    backups,
    lastMigrationBackup: backups.find((backup) => backup.name.endsWith('-migration.sqlite')) ?? null,
  };
}

/** Null rather than 0 for a file that cannot be measured: zero would read as an empty database. */
function fileBytes(file: string): number | null {
  try {
    return fs.statSync(file).size;
  } catch {
    return null;
  }
}
