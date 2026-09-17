import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { adminUser, connections, sessions } from '@/lib/db/schema';
import { createTestDb } from '../helpers/db';

const now = new Date('2026-09-17T10:00:00Z');

describe('database', () => {
  it('applies migrations and stores an admin', () => {
    const db = createTestDb();
    db.insert(adminUser).values({ email: 'admin@example.com', passwordHash: 'h', createdAt: now }).run();
    expect(db.select().from(adminUser).all()).toHaveLength(1);
  });

  it('round-trips JSON columns on connections', () => {
    const db = createTestDb();
    db.insert(connections)
      .values({
        id: 'abc123def456',
        name: 'production',
        method: 'role',
        awsAccountId: '123456789012',
        regions: ['eu-west-1', 'us-east-1'],
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const row = db.select().from(connections).where(eq(connections.id, 'abc123def456')).get();
    expect(row?.regions).toEqual(['eu-west-1', 'us-east-1']);
    expect(row?.lastTest).toBeNull();
  });

  it('deletes sessions when their admin is deleted', () => {
    const db = createTestDb();
    const { id } = db
      .insert(adminUser)
      .values({ email: 'a@example.com', passwordHash: 'h', createdAt: now })
      .returning({ id: adminUser.id })
      .get();
    db.insert(sessions).values({ id: 'token-hash', adminUserId: id, expiresAt: now, createdAt: now }).run();
    db.delete(adminUser).where(eq(adminUser.id, id)).run();
    expect(db.select().from(sessions).all()).toHaveLength(0);
  });
});
