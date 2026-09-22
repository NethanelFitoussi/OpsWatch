import 'server-only';
import type { Db } from '../db/client';

/**
 * Facts about the database itself, rather than about anything in it.
 *
 * It lives in the store because §9.6 is the rule it would otherwise break: `.$client` is the escape hatch for
 * statements drizzle does not express, and it belongs behind a repository like every other statement.
 */

/**
 * How many migrations have been applied, which is the schema version in the only sense that matters: an
 * upgrade whose migrations did not run shows a lower number than the release expects, rather than failing
 * silently later.
 *
 * Counted rather than read from an id, because drizzle's own table leaves that column null and orders by the
 * timestamp instead.
 */
export function appliedMigrations(db: Db): number | null {
  try {
    const row = db.$client.prepare('select count(*) as applied from __drizzle_migrations').get() as
      | { applied: number }
      | undefined;
    return row?.applied ?? null;
  } catch {
    // A database that has never been migrated has no such table, which is a fact rather than an error.
    return null;
  }
}
