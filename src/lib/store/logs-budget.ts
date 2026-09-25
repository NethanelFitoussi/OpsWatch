import 'server-only';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { connections, logSources, logsUsage, type LogsUsageRow } from '../db/schema';

/**
 * The Logs Insights budget (§9.5).
 *
 * Logs Insights is billed per gigabyte scanned, and it is the one OpsWatch cost that can surprise a
 * self-hoster: a badly-written query over a busy log group can scan hundreds of gigabytes in a minute. So the
 * budget is a **hard stop**, not a warning — the job stops for the rest of the day when it is reached — and
 * the spend is measured from what AWS itself reports as scanned, never from an estimate.
 *
 * **The cap belongs to the installation; the share belongs to the account.** `OPSWATCH_LOGS_BUDGET_GB_PER_DAY`
 * is what the operator is willing to spend in a day across everything, and connecting a second AWS account
 * must not quietly double their bill. But a single cap, spent first-come-first-served, meant one busy
 * account could consume all of it before another account's collection had run at all — every day, with
 * nothing on any page to say who spent it. So the cap is divided evenly between the accounts that can
 * actually spend it, and an account stops at its own share:
 *
 *   an account may query while `spent(account) < share` **and** `spent(everyone) < cap`
 *
 * Both clauses are needed. The first is what stops the starvation. The second is what keeps the operator's
 * bill inside the number they set on a day when the accounts changed underneath the arithmetic.
 */
export const BYTES_PER_GB = 1024 ** 3;
export const DAY_MS = 24 * 60 * 60_000;

/** The UTC day an instant belongs to. Days are UTC so an instance does not get two budgets at a timezone edge. */
export const dayOf = (at: number) => Math.floor(at / DAY_MS) * DAY_MS;

/**
 * How many accounts the cap is divided between.
 *
 * Only accounts with an enabled log source count: an account nothing is read from cannot spend, and
 * holding a share back for it would shrink everybody else's for no reason. Never below one, so the
 * arithmetic has no division by zero on an installation that is not collecting errors at all.
 */
export function spendingConnections(db: Db): number {
  const rows = db
    .selectDistinct({ connectionId: logSources.connectionId })
    .from(logSources)
    .innerJoin(connections, eq(connections.id, logSources.connectionId))
    .where(eq(logSources.enabled, true))
    .all();
  return Math.max(1, rows.length);
}

export function readUsage(db: Db, nowMs: number, connectionId: string): LogsUsageRow {
  const day = dayOf(nowMs);
  return (
    db
      .select()
      .from(logsUsage)
      .where(and(eq(logsUsage.day, day), eq(logsUsage.connectionId, connectionId)))
      .get() ?? { day, connectionId, bytesScanned: 0, queries: 0, stoppedAt: null }
  );
}

/** What every account together has scanned today. */
export function readUsageTotal(db: Db, nowMs: number): { bytesScanned: number; queries: number } {
  const rows = db.select().from(logsUsage).where(eq(logsUsage.day, dayOf(nowMs))).all();
  return {
    bytesScanned: rows.reduce((total, row) => total + row.bytesScanned, 0),
    queries: rows.reduce((total, row) => total + row.queries, 0),
  };
}

/** Records what a query actually scanned, as AWS reported it. */
export function recordScan(db: Db, nowMs: number, connectionId: string, bytesScanned: number): LogsUsageRow {
  const day = dayOf(nowMs);
  return db
    .insert(logsUsage)
    .values({ day, connectionId, bytesScanned, queries: 1, stoppedAt: null })
    .onConflictDoUpdate({
      target: [logsUsage.day, logsUsage.connectionId],
      set: {
        bytesScanned: sql`${logsUsage.bytesScanned} + ${bytesScanned}`,
        queries: sql`${logsUsage.queries} + 1`,
      },
    })
    .returning()
    .get();
}

/** Marks the day as stopped for this account, so the reason a job did nothing is recorded rather than inferred. */
export function recordBudgetStop(db: Db, nowMs: number, connectionId: string): void {
  const day = dayOf(nowMs);
  db.insert(logsUsage)
    .values({ day, connectionId, bytesScanned: 0, queries: 0, stoppedAt: nowMs })
    .onConflictDoUpdate({ target: [logsUsage.day, logsUsage.connectionId], set: { stoppedAt: nowMs } })
    .run();
}

export type BudgetState = {
  /** What this account has scanned today. */
  bytesScanned: number;
  /** What every account together has scanned today. */
  instanceBytesScanned: number;
  /** This account's share of the day's cap. */
  budgetBytes: number;
  /** The whole installation's cap for the day. */
  instanceBudgetBytes: number;
  /** How many accounts the cap is divided between; 1 means this account has all of it. */
  shares: number;
  remainingBytes: number;
  /** True when the job may not run another query today. */
  exhausted: boolean;
  /** Set when this account was stopped by the cap rather than by its own share. */
  stoppedByInstance: boolean;
  stoppedAt: number | null;
};

/**
 * Whether this account has budget left today.
 *
 * A budget of zero disables error collection outright, which is a legitimate configuration: an operator who
 * does not want OpsWatch touching Logs Insights at all sets it and nothing is ever scanned.
 */
export function budgetState(db: Db, nowMs: number, budgetGbPerDay: number, connectionId: string): BudgetState {
  const usage = readUsage(db, nowMs, connectionId);
  const total = readUsageTotal(db, nowMs);
  const shares = spendingConnections(db);
  const instanceBudgetBytes = Math.round(budgetGbPerDay * BYTES_PER_GB);
  const budgetBytes = Math.floor(instanceBudgetBytes / shares);
  const overShare = usage.bytesScanned >= budgetBytes;
  const overCap = total.bytesScanned >= instanceBudgetBytes;
  return {
    bytesScanned: usage.bytesScanned,
    instanceBytesScanned: total.bytesScanned,
    budgetBytes,
    instanceBudgetBytes,
    shares,
    remainingBytes: Math.max(0, Math.min(budgetBytes - usage.bytesScanned, instanceBudgetBytes - total.bytesScanned)),
    exhausted: overShare || overCap,
    // Which of the two clauses stopped it, because the operator's remedy differs: their own share is
    // spent, or somebody else's account spent the installation's cap out from under them.
    stoppedByInstance: overCap && !overShare,
    stoppedAt: usage.stoppedAt,
  };
}

/** Yesterday's spend for one account, which Settings shows so an operator can see what this actually costs. */
export function usageForDay(db: Db, dayMs: number, connectionId: string): LogsUsageRow | null {
  return (
    db
      .select()
      .from(logsUsage)
      .where(and(eq(logsUsage.day, dayOf(dayMs)), eq(logsUsage.connectionId, connectionId)))
      .get() ?? null
  );
}

/**
 * What Logs Insights scanned over a window, for §19's logs report.
 *
 * **Per connected account, not per environment.** `logs_usage` is keyed by UTC day and account, so a
 * report for one account reports that account's spend — but the regions inside it share one row, because
 * the bill and the budget are both properties of the account rather than of a region. A report that split
 * this per region would be inventing a split the table does not hold, so the report says which figure it is
 * instead.
 *
 * Half-open `[from, to)` over whole days, matching every other window in a report, so two consecutive
 * reports never count the same day twice.
 */
export function usageBetween(
  db: Db,
  connectionId: string,
  window: { from: number; to: number },
): { bytesScanned: number; queries: number; days: number; stoppedDays: number } {
  const rows = db
    .select()
    .from(logsUsage)
    .where(
      and(
        eq(logsUsage.connectionId, connectionId),
        gte(logsUsage.day, dayOf(window.from)),
        lt(logsUsage.day, window.to),
      ),
    )
    .all();
  return {
    bytesScanned: rows.reduce((total, row) => total + row.bytesScanned, 0),
    queries: rows.reduce((total, row) => total + row.queries, 0),
    days: rows.length,
    // A day the budget stopped is the fact worth reporting: it is the day errors went uncollected.
    stoppedDays: rows.filter((row) => row.stoppedAt !== null).length,
  };
}
