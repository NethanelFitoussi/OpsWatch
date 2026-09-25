import 'server-only';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  alertRules,
  alerts,
  awsCollection,
  awsCollectionStacks,
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
  logsUsage,
  hosts,
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
 * Two tables are deliberately **not** emptied, and for the same reason: they are not the connection's
 * to destroy.
 *
 *   - A **notification destination** scoped to this connection is the operator's own webhook, with a
 *     signing secret shown once and never again.
 *   - A **Linux host** matched to this connection is a machine. It exists whether or not anybody is
 *     watching the AWS account it happens to run in, its agent keeps reporting, and deleting it because
 *     an AWS connection went away would destroy readings from a machine nobody disconnected.
 *
 * Both have their link to the connection cleared instead, so they survive unattached — visible, still
 * working, and there for the operator to re-scope or remove themselves.
 *
 * The **audit log** is neither emptied nor unlinked. It records that this connection was created,
 * tested, changed and removed, and a log that disappears along with the thing it is evidence about is
 * not evidence. Unlinking would be no better: `store/audit.ts` contains no update and no delete, and
 * that is the property the log rests on. Its rows keep the id of an account that no longer exists, and
 * the page says "a removed account" rather than showing a dangling identifier.
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
    // One row per region of this account, and not a child of the row above: the consent belongs to the
    // account, the stack to a region, and the two are separate rows for exactly that reason.
    awsCollectionStacks,
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
    // The account's Logs Insights spend. Left behind it would keep holding a share of today's budget
    // for an account nobody is querying any more.
    logsUsage,
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
    // Unlinked rather than deleted: see above.
    tx.update(notifyDestinations).set({ connectionId: null }).where(eq(notifyDestinations.connectionId, connectionId)).run();
    tx.update(hosts).set({ connectionId: null }).where(eq(hosts.connectionId, connectionId)).run();
  });
  return removed;
}
