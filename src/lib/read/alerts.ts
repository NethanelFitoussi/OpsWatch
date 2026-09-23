import 'server-only';
import type { AlertSummary } from '@opswatch/contract';
import type { Db } from '../db/client';
import type { AlertRow } from '../db/schema';
import { listAlerts } from '../store/alerts';

/**
 * Alerts, as every client reads them (§15, §12).
 *
 * `suppressedCount` reaches the reader through `reason`, because §15.2's point is that the silence must be
 * **visible**. An alert that fired forty times and announced itself once is a different thing from one that
 * fired once, and a page that shows only "firing" has hidden the difference.
 */

/** How many alerts one page carries. */
export const ALERT_LIMIT = 100;

/** Renders a key in the caller's locale. The service never builds a sentence itself (§12.2). */
export type AlertLabels = {
  title: (key: string, values: Record<string, string | number>) => string;
  suppressed: (count: number) => string;
};

/**
 * The stored status onto the wire.
 *
 * These happen to be the same three words, plus the contract's `insufficient_data` for a provider alert
 * that cannot say. Mapped through a function anyway rather than passed through: the two lists are allowed
 * to diverge later, and a pass-through would fail silently on the day one of them does.
 */
export function wireAlertStatus(row: AlertRow): AlertSummary['status'] {
  if (row.resolvedAt !== null) return 'resolved';
  return row.acknowledgedAt !== null ? 'acknowledged' : 'firing';
}

export function toAlertSummary(row: AlertRow, labels: AlertLabels): AlertSummary {
  const reasons: string[] = [];
  if (row.suppressedCount > 0) reasons.push(labels.suppressed(row.suppressedCount));

  return {
    id: row.id,
    name: labels.title(row.titleKey, row.values),
    severity: row.severity,
    status: wireAlertStatus(row),
    // Where it came from, so a reader can tell an OpsWatch alert from a provider's own.
    source: 'opswatch',
    ...(reasons.length === 0 ? {} : { reason: reasons.join(' · ') }),
    since: row.firstFiredAt,
    resolvedAt: row.resolvedAt,
    ...(row.problemId === null ? {} : { problemId: row.problemId }),
  };
}

export function listAlertSummaries(db: Db, query: { connectionId: string; scope: string }, labels: AlertLabels): AlertSummary[] {
  return listAlerts(db, query.connectionId, query.scope, ALERT_LIMIT).map((row) => toAlertSummary(row, labels));
}
