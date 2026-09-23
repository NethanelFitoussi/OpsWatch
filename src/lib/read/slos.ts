import 'server-only';
import type { SloSummary } from '@opswatch/contract';
import type { Db } from '../db/client';
import type { SloDefinitionRow } from '../db/schema';
import { albBucket, evaluateSlo, latencyBucket, type Bucket, type SloResult } from '../detect/slo';
import { readHistorySettings } from '../history/settings';
import { readHistoryRange } from '../store/history';
import { listSloDefinitions } from '../store/slos';

/**
 * Measuring the objectives an operator defined, against stored history only (§19).
 *
 * The figure never comes from AWS: it is computed from the rollups the metrics job already wrote, so
 * reading an SLO costs nothing and two people looking at the same window see the same number.
 *
 * **A definition is not a measurement.** An objective somebody wrote down while history was off, or before
 * the metrics job had run on this environment, has a target and no current figure — and that is what it
 * reports. `current: null` with a `status` of `unknown` is the honest pair; a definition rendered at 100 %
 * because nothing has been measured would be the tool inventing a result (§2.4, §2.6).
 */

/** The resolution the metrics job writes, and therefore the one an objective is measured at. */
const RESOLUTION = '5m';
const RESOLUTION_MS = 5 * 60_000;

const DAY_MS = 24 * 60 * 60_000;

/** How much history one read will walk, so a long window cannot turn a page into a scan of a year. */
export const MAX_WINDOW_DAYS = 90;

export type SloWindow = { from: number; to: number };

export function windowOf(definition: Pick<SloDefinitionRow, 'windowDays'>, nowMs: number): SloWindow {
  const days = Math.min(MAX_WINDOW_DAYS, Math.max(1, definition.windowDays));
  return { from: nowMs - days * DAY_MS, to: nowMs };
}

/**
 * The buckets one definition is measured over.
 *
 * Availability reads three series and pairs them by interval; latency reads one and compares it with the
 * threshold. An interval missing from storage is simply absent, which `coverageOf` counts as unmeasured —
 * the gap is the reason a sparse window says "not enough history" rather than quietly averaging what it has.
 */
export function bucketsFor(db: Db, definition: SloDefinitionRow, window: SloWindow): Bucket[] {
  const read = (metric: string) =>
    new Map(
      readHistoryRange(
        db,
        {
          category: 'metric',
          connectionId: definition.connectionId,
          scope: definition.scope,
          subjectId: definition.subjectId,
          metric,
          resolution: RESOLUTION,
        },
        window.from,
        window.to,
      ).map((row) => [row.intervalStart, row.value]),
    );

  if (definition.kind === 'latency') {
    // Null threshold cannot be measured against, so every interval is unmeasured rather than passing.
    const threshold = definition.latencyThresholdMs;
    if (threshold === null) return [];
    // TargetResponseTime is seconds; the threshold an operator types is milliseconds.
    return [...read('p95').values()].map((value) => latencyBucket(value === null ? null : value * 1000, threshold));
  }

  const requests = read('requests');
  const elb = read('elb5xx');
  const target = read('target5xx');
  return [...requests.keys()].map((at) => albBucket(requests.get(at) ?? null, elb.get(at) ?? null, target.get(at) ?? null));
}

export function expectedBuckets(window: SloWindow): number {
  return Math.max(1, Math.round((window.to - window.from) / RESOLUTION_MS));
}

export function measure(db: Db, definition: SloDefinitionRow, nowMs: number): SloResult {
  const window = windowOf(definition, nowMs);
  return evaluateSlo(bucketsFor(db, definition, window), definition.objective, expectedBuckets(window));
}

/** `30d` and `7d` read the same way everywhere, so a client never has to parse a sentence to get the window. */
export function windowLabel(windowDays: number): string {
  return `${Math.min(MAX_WINDOW_DAYS, Math.max(1, windowDays))}d`;
}

function toSummary(definition: SloDefinitionRow, result: SloResult): SloSummary {
  return {
    id: definition.id,
    name: definition.name,
    service: { type: 'infrastructure', id: definition.subjectId, label: definition.subjectId },
    target: definition.objective,
    current: result.current,
    window: windowLabel(definition.windowDays),
    budgetRemaining: result.budgetRemaining,
    // Infinity is a real burn rate when the objective leaves no budget, and it is not a number JSON can
    // carry. Null is what the contract says for "no figure", which is also what a client can render.
    burnRate: result.burnRate === null || !Number.isFinite(result.burnRate) ? null : result.burnRate,
    status: result.status,
  };
}

/**
 * Every enabled objective of an environment, measured.
 *
 * With history off there is nothing stored to measure and every definition reports `unknown` — the
 * definitions are still listed, because an operator who turned history off has not deleted their targets.
 */
export function listSloSummaries(db: Db, query: { connectionId: string; scope: string }, nowMs: number): SloSummary[] {
  const historyOn = readHistorySettings(db).enabled;
  return listSloDefinitions(db, query.connectionId, query.scope)
    .filter((definition) => definition.enabled)
    .map((definition) =>
      toSummary(
        definition,
        historyOn
          ? measure(db, definition, nowMs)
          : { current: null, budgetRemaining: null, burnRate: null, status: 'unknown', coverage: 0, reason: 'not_enough_history' },
      ),
    );
}
