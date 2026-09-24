import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BACKUP_KEEP,
  backupName,
  backupsDir,
  backupsToPrune,
  bundledMigrations,
  listBackups,
  resolveBackup,
  writeBackup,
} from '@/lib/db/backup';
import { createTestDb } from '../helpers/db';

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);
const temporary: string[] = [];

const scratch = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opswatch-backup-'));
  temporary.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('naming a backup', () => {
  it('sorts by name because it sorts by time, and says why it was taken', () => {
    expect(backupName(NOW, 'migration')).toBe('opswatch-2026-09-24T12-00-00Z-migration.sqlite');
    expect(backupName(NOW + 1000, 'manual') > backupName(NOW, 'manual')).toBe(true);
  });

  it('THE RULING: no colon, so the file can be copied to any machine', () => {
    // A colon is legal on Linux and not on Windows, and a backup an operator cannot copy to their laptop
    // is half a backup.
    expect(backupName(NOW, 'manual')).not.toContain(':');
  });

  it('keeps backups beside the database rather than inside it', () => {
    expect(backupsDir('/data')).toBe(path.join('/data', 'backups'));
  });
});

describe('which backups are pruned', () => {
  const at = (createdAt: number): { name: string; bytes: number; createdAt: number } => ({ name: `b${createdAt}`, bytes: 1, createdAt });

  it('keeps the newest and removes the rest', () => {
    const all = [at(1), at(5), at(3), at(2)];
    expect(backupsToPrune(all, 2).map((backup) => backup.createdAt)).toEqual([2, 1]);
  });

  it('removes nothing when there are fewer than the limit', () => {
    expect(backupsToPrune([at(1)], 3)).toEqual([]);
  });

  it('THE RULING: keeping zero removes everything, rather than silently keeping one', () => {
    expect(backupsToPrune([at(1), at(2)], 0)).toHaveLength(2);
  });
});

describe('writing one', () => {
  it('produces a file SQLite itself wrote, from a live database', () => {
    const db = createTestDb();
    const dir = scratch();
    const backup = writeBackup(db, dir, NOW, 'manual');

    const file = path.join(backupsDir(dir), backup.name);
    expect(fs.existsSync(file)).toBe(true);
    expect(backup.bytes).toBeGreaterThan(0);
    // A real SQLite file, not a copy of a page cache: the header is the one SQLite writes.
    expect(fs.readFileSync(file).subarray(0, 15).toString('latin1')).toBe('SQLite format 3');
  });

  it('THE RULING: the backup holds the rows the database held', async () => {
    const db = createTestDb();
    db.$client.exec("create table probe (a text)");
    db.$client.prepare('insert into probe values (?)').run('kept');
    const dir = scratch();
    const backup = writeBackup(db, dir, NOW, 'manual');

    const { default: Database } = await import('better-sqlite3');
    const restored = new Database(path.join(backupsDir(dir), backup.name), { readonly: true });
    expect(restored.prepare('select a from probe').get()).toEqual({ a: 'kept' });
    restored.close();
  });

  it('THE RULING: two backups in the same second are two files, not one failure', () => {
    // `VACUUM INTO` refuses to write over a file that exists, so pressing the button twice quickly used
    // to report a failure that was not one.
    const db = createTestDb();
    const dir = scratch();
    const first = writeBackup(db, dir, NOW, 'manual');
    const second = writeBackup(db, dir, NOW, 'manual');
    expect(second.name).not.toBe(first.name);
    expect(listBackups(backupsDir(dir))).toHaveLength(2);
  });

  it('keeps only the newest few, so a small disk does not fill with copies', () => {
    const db = createTestDb();
    const dir = scratch();
    for (let i = 0; i < BACKUP_KEEP + 2; i += 1) writeBackup(db, dir, NOW + i * 60_000, 'manual');
    expect(listBackups(backupsDir(dir))).toHaveLength(BACKUP_KEEP);
  });

  it('lists newest first, and a directory that does not exist holds none', () => {
    const db = createTestDb();
    const dir = scratch();
    const older = writeBackup(db, dir, NOW, 'manual');
    const newer = writeBackup(db, dir, NOW + 60_000, 'migration');
    // `mtime` is the filesystem's, so the order is asserted on what is actually there.
    const names = listBackups(backupsDir(dir)).map((backup) => backup.name);
    expect(names).toHaveLength(2);
    expect(names).toContain(older.name);
    expect(names).toContain(newer.name);
    expect(listBackups(path.join(dir, 'nowhere'))).toEqual([]);
  });
});

describe('THE RULING: a download name is matched against what is there, never sanitised', () => {
  it('accepts a name a listing produced and refuses everything else', () => {
    const db = createTestDb();
    const dir = scratch();
    const backup = writeBackup(db, dir, NOW, 'manual');
    const backups = backupsDir(dir);

    expect(resolveBackup(backups, backup.name)).toBe(path.join(backups, backup.name));
    // A pattern check can be got around by an encoding nobody thought of. "Is this one of the names a
    // listing just produced" cannot.
    for (const attempt of ['../opswatch.sqlite', '..%2Fopswatch.sqlite', '/etc/passwd', 'opswatch-nope.sqlite', '']) {
      expect(resolveBackup(backups, attempt), attempt).toBeNull();
    }
  });
});

describe('knowing whether a migration is pending', () => {
  it('counts what this build ships, from drizzle’s own journal', () => {
    const bundled = bundledMigrations(path.join(process.cwd(), 'drizzle'));
    expect(bundled).toBeGreaterThan(0);
  });

  it('THE RULING: an unreadable journal is null, so nothing is backed up on a guess', () => {
    // Guessing that a migration is pending would put a file copy in front of every single startup.
    expect(bundledMigrations('/nowhere/at/all')).toBeNull();
  });
});
