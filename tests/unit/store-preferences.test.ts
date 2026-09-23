import { describe, expect, it } from 'vitest';
import { NOTIFICATION_CATEGORIES, userPreferencesSchema } from '@opswatch/contract';
import { DEFAULT_PREFERENCES, readPreferences, writePreferences } from '@/lib/store/preferences';
import { createTestDb } from '../helpers/db';
import { adminUser } from '@/lib/db/schema';

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);

const withUser = () => {
  const db = createTestDb();
  const user = db
    .insert(adminUser)
    .values({ email: 'a@example.com', passwordHash: 'x', createdAt: new Date(NOW) })
    .returning()
    .get();
  return { db, userId: user.id };
};

describe('what a user starts with', () => {
  it('THE RULING: critical only, so a new user does not turn notifications off entirely', () => {
    // A user told about everything switches it all off, and then hears nothing when it matters.
    const { db, userId } = withUser();
    expect(readPreferences(db, userId)).toMatchObject({ minSeverity: 'critical' });
    expect(DEFAULT_PREFERENCES.minSeverity).toBe('critical');
  });

  it('gets defaults rather than an empty object before they have chosen anything', () => {
    const { db, userId } = withUser();
    const prefs = readPreferences(db, userId);
    expect(prefs.categories.length).toBeGreaterThan(0);
    expect(() =>
      userPreferencesSchema.parse({ notifications: { minSeverity: prefs.minSeverity, categories: prefs.categories } }),
    ).not.toThrow();
  });
});

describe('§12 — an update is partial', () => {
  it('THE RULING: a field left out is not erased', () => {
    const { db, userId } = withUser();
    writePreferences(db, userId, { defaultEnvironmentId: 'c1:us-east-1', locale: 'fr' }, NOW);
    // A phone that knows nothing about defaultEnvironmentId must not clear it by omitting it.
    writePreferences(db, userId, { minSeverity: 'warning' }, NOW + 1000);

    expect(readPreferences(db, userId)).toMatchObject({
      defaultEnvironmentId: 'c1:us-east-1',
      locale: 'fr',
      minSeverity: 'warning',
    });
  });

  it('clears a field only when it is explicitly set to null', () => {
    const { db, userId } = withUser();
    writePreferences(db, userId, { locale: 'fr' }, NOW);
    writePreferences(db, userId, { locale: null }, NOW + 1000);
    expect(readPreferences(db, userId).locale).toBeNull();
  });

  it('THE RULING: an unknown category is dropped rather than stored', () => {
    const { db, userId } = withUser();
    // A newer client must not write a value an older server would then fail to parse back.
    writePreferences(db, userId, { categories: ['alert', 'not_a_real_category'] }, NOW);
    expect(readPreferences(db, userId).categories).toEqual(['alert']);
  });

  it('accepts every category the contract declares', () => {
    const { db, userId } = withUser();
    writePreferences(db, userId, { categories: [...NOTIFICATION_CATEGORIES] }, NOW);
    expect(readPreferences(db, userId).categories).toEqual([...NOTIFICATION_CATEGORIES]);
  });
});

describe('§12 — preferences belong to the user', () => {
  it('THE RULING: one user changing theirs changes nothing anybody else sees', () => {
    const { db, userId } = withUser();
    const other = db
      .insert(adminUser)
      .values({ email: 'b@example.com', passwordHash: 'x', createdAt: new Date(NOW) })
      .returning()
      .get();

    writePreferences(db, userId, { minSeverity: 'info' }, NOW);
    expect(readPreferences(db, other.id).minSeverity).toBe('critical');
  });
});
