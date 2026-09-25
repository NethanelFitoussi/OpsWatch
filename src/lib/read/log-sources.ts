import 'server-only';
import type { Db } from '../db/client';
import type { LogSourceRow } from '../db/schema';
import { presetOf, type FieldMapValues, type LogFormat } from '../errors/source-presets';
import { listLogSources, upsertLogSource } from '../store/errors';
import { BYTES_PER_GB, budgetState } from '../store/logs-budget';

/**
 * The log sources of one environment, and what switching one on will cost (§18, §9.5).
 *
 * Two things shape this file.
 *
 * **Configured sources are free to look at.** They come from the database, so opening the page costs nothing.
 * Discovery is an AWS call (`logs:DescribeLogGroups`), so it happens only when somebody searches — an
 * operator who has already configured everything pays nothing to review it.
 *
 * **Enabling a source starts spending money.** Logs Insights is billed per gigabyte scanned and
 * `OPSWATCH_LOGS_BUDGET_GB_PER_DAY` is a hard stop, so the page states the budget and what is left of it
 * before the decision rather than after it.
 */

/** How many groups one search may return, so a large account cannot produce an unbounded page. */
export const SEARCH_LIMIT = 50;

export type ConfiguredSource = {
  id: string;
  logGroup: string;
  serviceId: string | null;
  enabled: boolean;
  format: LogFormat;
  fields: FieldMapValues;
  /** Which preset this matches, or `custom`. */
  preset: string;
};

export type SourcesView = {
  sources: ConfiguredSource[];
  enabled: number;
  budget: {
    scannedGb: number;
    /** This account's share of the day, which is the whole cap when it is the only one reading logs. */
    limitGb: number;
    remainingGb: number;
    exhausted: boolean;
    /** How many accounts the installation's cap is divided between. */
    shares: number;
    instanceLimitGb: number;
  };
};

function toConfigured(row: LogSourceRow): ConfiguredSource {
  const fields = (row.fieldMap ?? {}) as FieldMapValues;
  return {
    id: row.id,
    logGroup: row.logGroup,
    serviceId: row.serviceId,
    enabled: row.enabled,
    format: row.format,
    fields,
    preset: presetOf(row.format, fields),
  };
}

export function readSources(db: Db, query: { connectionId: string; scope: string }, context: { nowMs: number; budgetGbPerDay: number }): SourcesView {
  const rows = listLogSources(db, query.connectionId, query.scope);
  const budget = budgetState(db, context.nowMs, context.budgetGbPerDay, query.connectionId);
  return {
    sources: rows.map(toConfigured),
    enabled: rows.filter((row) => row.enabled).length,
    budget: {
      scannedGb: budget.bytesScanned / BYTES_PER_GB,
      limitGb: budget.budgetBytes / BYTES_PER_GB,
      remainingGb: budget.remainingBytes / BYTES_PER_GB,
      exhausted: budget.exhausted,
      shares: budget.shares,
      instanceLimitGb: context.budgetGbPerDay,
    },
  };
}

export type SaveSourceInput = {
  connectionId: string;
  scope: string;
  logGroup: string;
  serviceId: string | null;
  enabled: boolean;
  format: LogFormat;
  fields: FieldMapValues;
};

/**
 * Writes one source. `upsertLogSource` keys on `(connectionId, scope, logGroup)`, so saving the same group
 * twice edits it rather than adding a second row — which is what makes the form idempotent under a refresh.
 */
export function saveSource(db: Db, input: SaveSourceInput, nowMs: number): ConfiguredSource {
  return toConfigured(
    upsertLogSource(db, {
      connectionId: input.connectionId,
      scope: input.scope,
      logGroup: input.logGroup,
      serviceId: input.serviceId,
      enabled: input.enabled,
      format: input.format,
      // Only the paths. The log content is never stored, which is the point of §18's design.
      fieldMap: { ...input.fields },
      createdAt: nowMs,
    }),
  );
}
