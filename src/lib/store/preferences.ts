import 'server-only';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { NOTIFICATION_CATEGORIES } from '@opswatch/contract';
import { userPreferences, type UserPreferencesRow } from '../db/schema';

/**
 * What one user chose for themselves (§12).
 *
 * Keyed by the user, never by the instance. A viewer changing what they want to be told about must not
 * change anything anybody else sees, and the primary key makes that structural rather than a rule somebody
 * has to remember.
 */

/**
 * What a fresh user gets: critical only, everything on.
 *
 * Critical-only is the floor a monitoring tool should start at. A new user who is told about everything
 * turns notifications off entirely, and then hears nothing when it matters.
 */
export const DEFAULT_PREFERENCES = {
  minSeverity: 'critical' as const,
  categories: [...NOTIFICATION_CATEGORIES],
};

export function readPreferences(db: Db, adminUserId: number): UserPreferencesRow {
  const row = db.select().from(userPreferences).where(eq(userPreferences.adminUserId, adminUserId)).get();
  return (
    row ?? {
      adminUserId,
      locale: null,
      defaultEnvironmentId: null,
      minSeverity: DEFAULT_PREFERENCES.minSeverity,
      categories: [...DEFAULT_PREFERENCES.categories],
      updatedAt: 0,
    }
  );
}

export type PreferencesPatch = {
  locale?: string | null;
  defaultEnvironmentId?: string | null;
  minSeverity?: UserPreferencesRow['minSeverity'];
  categories?: string[];
};

/**
 * Merges a patch over what is stored.
 *
 * A partial update, because the contract says a client sends only what it is changing — so a phone that
 * knows nothing about `defaultEnvironmentId` cannot erase it by omitting it.
 */
export function writePreferences(db: Db, adminUserId: number, patch: PreferencesPatch, nowMs: number): UserPreferencesRow {
  const current = readPreferences(db, adminUserId);
  const next = {
    adminUserId,
    locale: patch.locale === undefined ? current.locale : patch.locale,
    defaultEnvironmentId: patch.defaultEnvironmentId === undefined ? current.defaultEnvironmentId : patch.defaultEnvironmentId,
    minSeverity: patch.minSeverity ?? current.minSeverity,
    // An unknown category is dropped rather than stored, so a newer client cannot write a value an older
    // server would then fail to parse back.
    categories: (patch.categories ?? current.categories).filter((category) =>
      (NOTIFICATION_CATEGORIES as readonly string[]).includes(category),
    ),
    updatedAt: nowMs,
  };

  return db
    .insert(userPreferences)
    .values(next)
    .onConflictDoUpdate({ target: userPreferences.adminUserId, set: next })
    .returning()
    .get();
}
