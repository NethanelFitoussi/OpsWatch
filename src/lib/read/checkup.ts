import 'server-only';
import { TEMPLATE_VERSION } from '../aws/actions';
import { findConnection } from '../connections/repository';
import type { Db } from '../db/client';
import { runCheckup, type Checkup, type CheckupInput } from '../detect/checkup';
import { readHistorySettings } from '../history/settings';
import { lastRuns } from '../store/collector';
import { listLogSources } from '../store/errors';
import { listFamilySnapshots } from '../store/health';
import { BYTES_PER_GB, budgetState } from '../store/logs-budget';

/**
 * Assembles the Checkup catalogue's inputs from what is already stored.
 *
 * Nothing here calls AWS. Every input is a row the collector, the connection test or the operator already
 * wrote, which is what lets a checkup be run as often as anyone likes without moving the bill — the property
 * Stage 3 asked for when it capped the page's query budget, taken to its conclusion.
 *
 * The catalogue itself lives in `lib/detect/checkup.ts` and is pure. This file is the only part that knows
 * about the database, so a check can be tested against a fixture rather than against an environment.
 */

/** How many recent runs decide whether a job is failing. One bad run is noise; the newest run is the verdict. */
export const RECENT_RUNS = 40;

/** The jobs whose newest run failed. The newest per job wins, so a job that recovered is not reported. */
export function failingJobs(runs: readonly { job: string; status: string }[]): string[] {
  const newest = new Map<string, string>();
  // `lastRuns` answers newest first, so the first sighting of a job is its latest run.
  for (const run of runs) if (!newest.has(run.job)) newest.set(run.job, run.status);
  return [...newest.entries()].filter(([, status]) => status === 'failed').map(([job]) => job);
}

/**
 * The context a checkup needs from outside the database. The budget arrives as a number rather than being
 * read from the environment here: a read service that reaches for `process.env` cannot be run against a
 * fixture, and the edge that serves the page already knows its own configuration.
 */
export type CheckupContext = { nowMs: number; logsBudgetGbPerDay: number };

export function checkupInput(db: Db, query: { connectionId: string; scope: string }, context: CheckupContext): CheckupInput {
  const connection = findConnection(db, query.connectionId);
  const sources = listLogSources(db, query.connectionId, query.scope);
  const runs = lastRuns(db, RECENT_RUNS);
  const budgetGb = context.logsBudgetGbPerDay;
  const budget = budgetState(db, context.nowMs, budgetGb, query.connectionId);

  return {
    permissions:
      connection?.lastTest == null
        ? null
        : {
            accountMatches: connection.lastTest.accountMatches,
            testedAt: connection.lastTest.testedAt,
            // Narrowed to what a check reads: a permission test result is not a catalogue input wholesale.
            checks: connection.lastTest.checks.map((check) => ({
              service: check.service,
              status: check.status,
              ...(check.errorCode === undefined ? {} : { errorCode: check.errorCode }),
            })),
          },
    families: listFamilySnapshots(db, query.connectionId, query.scope).map((snapshot) => ({
      family: snapshot.family,
      unavailableReason: snapshot.unavailableReason,
      unavailableCode: snapshot.unavailableCode,
    })),
    logSources: { total: sources.length, enabled: sources.filter((source) => source.enabled).length },
    history: { enabled: readHistorySettings(db).enabled },
    // A budget of zero is "no querying allowed", not "no budget configured", so it is still judged.
    logsBudget: {
      exhausted: budget.exhausted,
      scannedGb: budget.bytesScanned / BYTES_PER_GB,
      // This account's share, not the installation's cap: the figure beside it is this account's spend.
      limitGb: budget.budgetBytes / BYTES_PER_GB,
      stoppedByInstance: budget.stoppedByInstance,
    },
    collector: { neverRan: runs.length === 0, failingJobs: failingJobs(runs) },
    template: { version: connection?.templateVersion ?? null, current: TEMPLATE_VERSION },
  };
}

export function readCheckup(db: Db, query: { connectionId: string; scope: string }, context: CheckupContext): Checkup {
  return runCheckup(checkupInput(db, query, context));
}
