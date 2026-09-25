import { describe, expect, it } from 'vitest';
import { readStorageState } from '@/lib/read/storage-state';
import { createTestDb } from '../helpers/db';

/**
 * Where the data is, and whether it is safe — as one answer rather than three pages.
 *
 * The temptation on a page like this is the reassuring default: a size of zero for a file nobody could
 * measure, "up to date" for a journal nobody could read. Both would tell an operator their data is fine
 * on exactly the evidence that says nobody knows.
 */

describe('what OpsWatch says about its own storage', () => {
  it('counts the migrations it has applied against the ones it ships', () => {
    const db = createTestDb();
    const state = readStorageState(db, { dataDir: '/nowhere', migrationsFolder: 'drizzle' });
    // The in-memory database is migrated when it opens, so it carries every bundled migration.
    expect(state.schema.applied).toBe(state.schema.bundled);
    expect(state.schema.pending).toBe(0);
    expect(state.schema.bundled).toBeGreaterThan(20);
  });

  it('THE RULING: it cannot tell rather than saying nothing is pending', () => {
    /*
     * A journal that cannot be read means the difference is unknowable. Reporting `0` would be the page
     * telling an operator their schema is current on the evidence that nobody knows what it is.
     */
    const db = createTestDb();
    const state = readStorageState(db, { dataDir: '/nowhere', migrationsFolder: '/no/such/folder' });
    expect(state.schema.bundled).toBeNull();
    expect(state.schema.pending).toBeNull();
  });

  it('THE RULING: a file it cannot measure has no size, not a size of zero', () => {
    // Zero bytes reads as "an empty database", which is a claim about the data rather than about the
    // measurement.
    const db = createTestDb();
    expect(readStorageState(db, { dataDir: '/no/such/dir', migrationsFolder: 'drizzle' }).bytes).toBeNull();
  });

  it('reports no backups for a directory that does not exist, which is not an error', () => {
    const db = createTestDb();
    const state = readStorageState(db, { dataDir: '/no/such/dir', migrationsFolder: 'drizzle' });
    expect(state.backups).toEqual([]);
    expect(state.lastMigrationBackup).toBeNull();
  });

  it('says where the data is and whether that place survives a restart', () => {
    const db = createTestDb();
    const state = readStorageState(db, { dataDir: '/no/such/dir', migrationsFolder: 'drizzle' });
    expect(state.where.dataDir).toBe('/no/such/dir');
    expect(typeof state.where.persistent).toBe('boolean');
  });
});
