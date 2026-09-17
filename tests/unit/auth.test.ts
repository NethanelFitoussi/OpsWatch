import { describe, expect, it } from 'vitest';
import {
  AdminExistsError,
  AdminValidationError,
  authenticate,
  createAdmin,
  hasAdmin,
} from '@/lib/auth/admin';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { SESSION_TTL_MS, createSession, deleteSession, validateSession } from '@/lib/auth/sessions';
import { adminUser } from '@/lib/db/schema';
import { createTestDb } from '../helpers/db';

const SECRET = 's'.repeat(32);
const PASSWORD = 'correct horse battery';

describe('password hashing', () => {
  it('hashes with argon2id and verifies', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, PASSWORD)).toBe(true);
    expect(await verifyPassword(hash, 'wrong password!')).toBe(false);
  });

  it('returns false for a malformed hash instead of throwing', async () => {
    expect(await verifyPassword('not-a-hash', PASSWORD)).toBe(false);
  });
});

describe('admin account', () => {
  it('creates the single admin and authenticates it', async () => {
    const db = createTestDb();
    expect(hasAdmin(db)).toBe(false);
    const id = await createAdmin(db, { email: 'Admin@Example.com', password: PASSWORD });
    expect(hasAdmin(db)).toBe(true);
    expect(await authenticate(db, 'admin@example.com', PASSWORD)).toBe(id);
    expect(await authenticate(db, 'admin@example.com', 'wrong password!')).toBeNull();
    expect(await authenticate(db, 'nobody@example.com', PASSWORD)).toBeNull();
  });

  it('refuses a second admin', async () => {
    const db = createTestDb();
    await createAdmin(db, { email: 'a@example.com', password: PASSWORD });
    await expect(createAdmin(db, { email: 'b@example.com', password: PASSWORD })).rejects.toBeInstanceOf(
      AdminExistsError,
    );
  });

  it('validates email and password length', async () => {
    const db = createTestDb();
    await expect(createAdmin(db, { email: 'nope', password: PASSWORD })).rejects.toMatchObject({
      code: 'email_invalid',
    });
    await expect(createAdmin(db, { email: 'a@example.com', password: 'short' })).rejects.toBeInstanceOf(
      AdminValidationError,
    );
  });

  it('allows only one admin when two setups race', async () => {
    const db = createTestDb();
    const results = await Promise.allSettled([
      createAdmin(db, { email: 'a@example.com', password: PASSWORD }),
      createAdmin(db, { email: 'b@example.com', password: PASSWORD }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(AdminExistsError);

    const rows = db.select().from(adminUser).all();
    expect(rows).toHaveLength(1);
  });
});

describe('sessions', () => {
  it('creates, validates with rolling expiry, and deletes', async () => {
    const db = createTestDb();
    const adminId = await createAdmin(db, { email: 'a@example.com', password: PASSWORD });
    const t0 = new Date('2026-09-17T10:00:00Z');
    const token = createSession(db, adminId, SECRET, t0);

    const t1 = new Date(t0.getTime() + SESSION_TTL_MS - 60_000);
    expect(validateSession(db, token, SECRET, t1)).toBe(adminId);

    // rolling: still valid one full TTL after the last use
    const t2 = new Date(t1.getTime() + SESSION_TTL_MS - 60_000);
    expect(validateSession(db, token, SECRET, t2)).toBe(adminId);

    deleteSession(db, token, SECRET);
    expect(validateSession(db, token, SECRET, t2)).toBeNull();
  });

  it('rejects an expired session and a token checked with another secret', async () => {
    const db = createTestDb();
    const adminId = await createAdmin(db, { email: 'a@example.com', password: PASSWORD });
    const t0 = new Date('2026-09-17T10:00:00Z');
    const token = createSession(db, adminId, SECRET, t0);
    expect(validateSession(db, token, 'o'.repeat(32), t0)).toBeNull();
    expect(validateSession(db, token, SECRET, new Date(t0.getTime() + SESSION_TTL_MS + 1))).toBeNull();
  });
});
