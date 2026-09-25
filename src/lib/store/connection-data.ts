import 'server-only';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  alertRules,
  alerts,
  awsCollection,
  collectorRuns,
  deployments,
  errorGroups,
  events,
  familySnapshots,
  historyPoints,
  historyWatermarks,
  incidents,
  installRuleOffers,
  logSources,
  metricBaselines,
  notifyDestinations,
  problems,
  savedLogSearches,
  serviceRepositories,
  sloDefinitions,
  syntheticChecks,
  userMarks,
} from '../db/schema';

/**
 * Everything one AWS connection wrote, removed with it.
 *
 * Deleting a connection used to delete one row. Four tables carry a foreign key that cascades; the other
 * nineteen are plain `connection_id` columns, so every problem, alert, error group, deployment, log
 * source, saved search, history point and baseline that account ever produced stayed in the database
 * for ever — not reachable through any page, because every page is scoped, but still counted by the
 * instance-wide reads, still growing the file, and still holding an operator's data for an account they
 * had explicitly disconnected. Retention never reached them either: it removes *resolved* problems and
 * *old* events, not rows belonging to nobody.
 *
 * Explicit rather than a cascade, deliberately. Nineteen `ALTER TABLE`s in SQLite mean nineteen table
 * rebuilds on a database holding real history, and a list in one function can be read, reviewed and
 * held to the schema by a test — `tests/unit/store-connection-data.test.ts` reads `connection_id` out
 * of the live schema and fails when a table appears that this function does not name.
 *
 * Children cascade from their parents (`problem_evidence`, `incident_timeline`, `error_occurrences`,
 * `synthetic_runs`, `deployment_commits`, and the three ingestion tables under `aws_collection`), so
 * they are not listed: deleting the parent takes them.
 *
 * One table is deliberately **not** emptied. A notification destination scoped to this connection is
 * the operator's own webhook, with its own signing secret shown once and never again; deleting a
 * connection must not silently destroy it. Its scope is cleared instead, so it survives as an unscoped
 * destination — visible, still working, and there for the operator to re-scope or remove themselves.
 */
/**
 * The tables this purge empties, in the order it empties them.
 *
 * Exported so a test can hold it against the live schema: every table with a `connection_id` column
 * must be in here, and a new one that is not fails on the day it is added rather than leaking rows on
 * every disconnect from then on.
 */
export const PURGED_TABLES = [
    // The push-collection tables cascade from this one, so it goes first and takes them.
    awsCollection,
    problems,
    alerts,
    alertRules,
    incidents,
    syntheticChecks,
    errorGroups,
    logSources,
    deployments,
    serviceRepositories,
    familySnapshots,
    userMarks,
    historyPoints,
    historyWatermarks,
    sloDefinitions,
    installRuleOffers,
    metricBaselines,
    savedLogSearches,
    // Nullable columns: an instance-wide row has no connection and must survive.
    events,
    collectorRuns,
  ] as const;

export function purgeConnectionData(db: Db, connectionId: string): number {
  let removed = 0;
  // One transaction: a half-removed connection would leave rows that no page can reach and no future
  // delete will find, because the connection they belong to is already gone.
  db.transaction((tx) => {
    for (const table of PURGED_TABLES) {
      removed += tx.delete(table).where(eq(table.connectionId, connectionId)).run().changes;
    }
    // Unscoped rather than deleted: see above.
    tx.update(notifyDestinations).set({ connectionId: null }).where(eq(notifyDestinations.connectionId, connectionId)).run();
  });
  return removed;
}
