import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { adminUser, connections, problems, sessions } from '@/lib/db/schema';
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

  it('applies the problems migration, assigning seq and round-tripping the JSON columns', () => {
    const db = createTestDb();
    const at = now.getTime();
    const row = db
      .insert(problems)
      .values({
        id: 'p1',
        key: 'k'.repeat(32),
        connectionId: 'abc123def456',
        scope: 'eu-west-1',
        kind: 'ecs_cpu_high',
        subjectType: 'service',
        subjectId: 'prod/web',
        subjectName: 'web',
        serviceId: 'prod/web',
        source: 'aws',
        titleKey: 'Insights.messages.ecs_cpu_high',
        values: { service: 'web', value: 96 },
        severity: 'critical',
        score: 82,
        scoreTerms: {
          s: 1, b: 0.5, t: 1, u: 1, d: 0,
          weights: { s: 40, b: 20, t: 15, u: 15, d: 10 },
          availableWeight: 100, rescaled: false, floored: false, score: 82,
        },
        status: 'open',
        href: '/c/abc123def456/eu-west-1/containers/services/prod/web',
        firstSeenAt: at,
        lastSeenAt: at,
        lastEvaluatedAt: at,
      })
      .returning()
      .get();
    expect(row.seq).toBe(1);
    expect(row.values).toEqual({ service: 'web', value: 96 });
    expect(row.scoreTerms.weights.s).toBe(40);
    // The columns a fresh row must not invent: nothing is measured until something measures it.
    expect(row.resolvedAt).toBeNull();
    expect(row.occurrences).toBe(1);
    expect(row.grouped).toBe(false);
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
