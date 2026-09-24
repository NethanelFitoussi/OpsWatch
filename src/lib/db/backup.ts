import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './client';

/**
 * Backups of the database OpsWatch keeps itself (HIS-10).
 *
 * Two things this exists to do, and one it deliberately refuses.
 *
 * **Back up before a migration changes the schema.** An upgrade that goes wrong otherwise leaves an
 * operator with a database in a shape neither version understands, and the only honest advice would be
 * "you should have had a backup". One file copy on an upgrade removes that caveat from every future
 * migration rather than from one of them.
 *
 * **Back up on demand**, so an operator can take one before doing something themselves.
 *
 * **It does not restore.** A running process cannot safely write over the database it has open, and a
 * restore that half-succeeds is worse than no restore at all. The honest answer is the procedure —
 * stop OpsWatch, put the file back, start it — and the page says exactly that.
 *
 * `VACUUM INTO` rather than a file copy: the database runs in WAL mode, where a plain copy can miss
 * committed pages that are still in the write-ahead log. SQLite's own writer produces a consistent file
 * from a live database, and produces a compacted one as a side effect.
 */

/** How many are kept. Three upgrades' worth: enough to go back past a bad one, bounded on a small disk. */
export const BACKUP_KEEP = 3;

/** The directory backups live in, beside the database rather than inside it. */
export function backupsDir(dataDir: string): string {
  return path.join(dataDir, 'backups');
}

/**
 * The name of a backup taken at an instant.
 *
 * Sortable, UTC, and with no colons — a colon is legal on Linux and not on Windows, and a backup an
 * operator cannot copy to their laptop is half a backup.
 */
export function backupName(nowMs: number, reason: BackupReason): string {
  const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
  return `opswatch-${stamp}-${reason}.sqlite`;
}

/** Why a backup was taken. It is in the filename, so a directory listing explains itself. */
const BACKUP_REASONS = ['migration', 'manual'] as const;
export type BackupReason = (typeof BACKUP_REASONS)[number];

export type Backup = { name: string; bytes: number; createdAt: number };

const BACKUP_PATTERN = /^opswatch-.+\.sqlite$/;

/** What is on disk, newest first. A directory that does not exist yet holds no backups, which is not an error. */
export function listBackups(dir: string): Backup[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => BACKUP_PATTERN.test(name))
    .map((name) => {
      const stats = fs.statSync(path.join(dir, name));
      return { name, bytes: stats.size, createdAt: stats.mtimeMs };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Which backups to delete, given what is on disk and how many to keep.
 *
 * Pure, and separate from the deleting, because "which files does this remove" is the question worth a
 * test — and a test that had to create files to ask it would be testing the filesystem.
 */
export function backupsToPrune(backups: readonly Backup[], keep: number): Backup[] {
  return [...backups].sort((a, b) => b.createdAt - a.createdAt).slice(Math.max(0, keep));
}

/**
 * A name from a URL, resolved to a path inside the backups directory — or null.
 *
 * `null` for anything that is not one of the files actually there. Not a pattern check and not a
 * `..` filter: the only names accepted are the ones a listing just produced, which is the one rule that
 * cannot be got around by an encoding nobody thought of.
 */
export function resolveBackup(dir: string, name: string): string | null {
  return listBackups(dir).some((backup) => backup.name === name) ? path.join(dir, name) : null;
}

/**
 * Writes one backup and prunes the old ones.
 *
 * Synchronous on purpose: the migration path runs before anything is served, and an async backup there
 * would mean a request could arrive against a half-migrated database.
 */
export function writeBackup(db: Db, dataDir: string, nowMs: number, reason: BackupReason): Backup {
  const dir = backupsDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const name = freeName(dir, backupName(nowMs, reason));
  const target = path.join(dir, name);
  // A single quote is the only character that could end the literal, and SQLite escapes it by doubling.
  db.$client.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);

  for (const stale of backupsToPrune(listBackups(dir), BACKUP_KEEP)) {
    fs.rmSync(path.join(dir, stale.name), { force: true });
  }
  return { name, bytes: fs.statSync(target).size, createdAt: nowMs };
}

/**
 * A name nothing is using yet.
 *
 * Two backups taken in the same second would otherwise be the same filename, and `VACUUM INTO` refuses to
 * write over a file that exists — so pressing the button twice quickly reported a failure that was not
 * one. Seconds stay in the name because they are what an operator reads; the suffix only appears when it
 * has to.
 */
function freeName(dir: string, name: string): string {
  if (!fs.existsSync(path.join(dir, name))) return name;
  const stem = name.replace(/\.sqlite$/, '');
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${stem}-${suffix}.sqlite`;
    if (!fs.existsSync(path.join(dir, candidate))) return candidate;
  }
  return `${stem}-${Date.now()}.sqlite`;
}

/**
 * How many migrations this build has, read from drizzle's own journal.
 *
 * Returns null when the journal cannot be read, and the caller then does not back up: guessing that a
 * migration is pending would put a file copy in front of every single startup.
 */
export function bundledMigrations(migrationsFolder: string): number | null {
  try {
    const journal = JSON.parse(fs.readFileSync(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as {
      entries?: unknown[];
    };
    return Array.isArray(journal.entries) ? journal.entries.length : null;
  } catch {
    return null;
  }
}
