import 'server-only';
import type { Db } from '../db/client';

/**
 * better-sqlite3 is synchronous, so a transaction holds the event loop for as long as it runs and the instance
 * serves nothing while it does. §9.2 fixes the rule: a write is split into transactions of at most this many rows,
 * with a yield between them, so rendering interleaves with collection instead of queueing behind it.
 */
export const MAX_ROWS_PER_TRANSACTION = 1000;

/**
 * Writes `rows` in batches, each in its own transaction, yielding to the event loop between them. Answers how many
 * rows were written.
 *
 * A batch that throws rolls back that batch alone — the ones before it are already committed. That is deliberate:
 * a collection cycle that fails halfway should leave the work it already did behind rather than discard an hour of
 * it, and every writer here is idempotent on its dedupe key, so the failed batch is simply written again next cycle.
 */
export async function inBatches<T>(
  db: Db,
  rows: readonly T[],
  write: (tx: Db, batch: readonly T[]) => void,
): Promise<number> {
  let written = 0;
  for (let start = 0; start < rows.length; start += MAX_ROWS_PER_TRANSACTION) {
    const batch = rows.slice(start, start + MAX_ROWS_PER_TRANSACTION);
    db.transaction((tx) => write(tx as unknown as Db, batch));
    written += batch.length;
    // Only between batches: a single-batch write should not pay a tick it does not need.
    if (start + MAX_ROWS_PER_TRANSACTION < rows.length) {
      await new Promise(setImmediate);
    }
  }
  return written;
}
