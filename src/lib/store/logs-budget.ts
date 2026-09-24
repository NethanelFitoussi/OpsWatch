import 'server-only';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { logsUsage, type LogsUsageRow } from '../db/schema';

/**
 * The Logs Insights budget (§9.5).
 *
 * Logs Insights is billed per gigabyte scanned, and it is the one OpsWatch cost that can surprise a
 * self-hoster: a badly-written query over a busy log group can scan hundreds of gigabytes in a minute. So the
 * budget is a **hard stop**, not a warning — the job stops for the rest of the day when it is reached — and
 * the spend is measured from what AWS itself reports as scanned, never from an estimate.
 */
export const BYTES_PER_GB = 1024 ** 3;
export const DAY_MS = 24 * 60 * 60_000;

/** The UTC day an instant belongs to. Days are UTC so an instance does not get two budgets at a timezone edge. */
export const dayOf = (at: number) => Math.floor(at / DAY_MS) * DAY_MS;

export function readUsage(db: Db, nowMs: number): LogsUsageRow {
  const day = dayOf(nowMs);
  return (
    db.select().from(logsUsage).where(eq(logsUsage.day, day)).get() ?? {
      day,
      bytesScanned: 0,
      queries: 0,
      stoppedAt: null,
    }
  );
}

/** Records what a query actually scanned, as AWS reported it. */
export function recordScan(db: Db, nowMs: number, bytesScanned: number): LogsUsageRow {
  const day = dayOf(nowMs);
  return db
    .insert(logsUsage)
    .values({ day, bytesScanned, queries: 1, stoppedAt: null })
    .onConflictDoUpdate({
      target: logsUsage.day,
      set: {
        bytesScanned: sql`${logsUsage.bytesScanned} + ${bytesScanned}`,
        queries: sql`${logsUsage.queries} + 1`,
      },
    })
    .returning()
    .get();
}

/** Marks the day as stopped, so the reason a job did nothing is recorded rather than inferred. */
export function recordBudgetStop(db: Db, nowMs: number): void {
  const day = dayOf(nowMs);
  db.insert(logsUsage)
    .values({ day, bytesScanned: 0, queries: 0, stoppedAt: nowMs })
    .onConflictDoUpdate({ target: logsUsage.day, set: { stoppedAt: nowMs } })
    .run();
}

export type BudgetState = {
  bytesScanned: number;
  budgetBytes: number;
  remainingBytes: number;
  /** True when the job may not run another query today. */
  exhausted: boolean;
  stoppedAt: number | null;
};

/**
 * Whether there is budget left today.
 *
 * A budget of zero disables error collection outright, which is a legitimate configuration: an operator who
 * does not want OpsWatch touching Logs Insights at all sets it and nothing is ever scanned.
 */
export function budgetState(db: Db, nowMs: number, budgetGbPerDay: number): BudgetState {
  const usage = readUsage(db, nowMs);
  const budgetBytes = Math.round(budgetGbPerDay * BYTES_PER_GB);
  return {
    bytesScanned: usage.bytesScanned,
    budgetBytes,
    remainingBytes: Math.max(0, budgetBytes - usage.bytesScanned),
    exhausted: usage.bytesScanned >= budgetBytes,
    stoppedAt: usage.stoppedAt,
  };
}

/** Yesterday's spend, which Settings shows so an operator can see what this actually costs. */
export function usageForDay(db: Db, dayMs: number): LogsUsageRow | null {
  return db.select().from(logsUsage).where(eq(logsUsage.day, dayOf(dayMs))).get() ?? null;
}

/**
 * What Logs Insights scanned over a window, for §19's logs report.
 *
 * **Instance-wide, not per environment.** `logs_usage` is keyed by UTC day and nothing else, because the
 * budget it exists for is a property of the installation: one OpsWatch, one daily cap, whatever it is
 * looking at. A report that split this per environment would be inventing a split the table does not hold,
 * so the report says which figure it is instead.
 *
 * Half-open `[from, to)` over whole days, matching every other window in a report, so two consecutive
 * reports never count the same day twice.
 */
export function usageBetween(
  db: Db,
  window: { from: number; to: number },
): { bytesScanned: number; queries: number; days: number; stoppedDays: number } {
  const rows = db
    .select()
    .from(logsUsage)
    .where(and(gte(logsUsage.day, dayOf(window.from)), lt(logsUsage.day, window.to)))
    .all();
  return {
    bytesScanned: rows.reduce((total, row) => total + row.bytesScanned, 0),
    queries: rows.reduce((total, row) => total + row.queries, 0),
    days: rows.length,
    // A day the budget stopped is the fact worth reporting: it is the day errors went uncollected.
    stoppedDays: rows.filter((row) => row.stoppedAt !== null).length,
  };
}
