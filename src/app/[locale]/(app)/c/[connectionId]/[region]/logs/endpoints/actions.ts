'use server';

import { resolveLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/auth/current';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';
import type { ActionState } from '@/lib/forms/action-state';
import { formString } from '@/lib/forms/form-data';
import { isSafeField, runEndpointsQuery, type EndpointRow } from '@/lib/monitoring/endpoints';
import { resolveTarget } from '@/lib/monitoring/target';
import { enabledLogSources } from '@/lib/store/errors';
import { budgetState, recordScan } from '@/lib/store/logs-budget';
import { WINDOW_CHOICES } from './window-choices';

export type EndpointsState = ActionState<
  'invalid_field' | 'no_sources' | 'budget_exhausted' | 'query_failed',
  { rows?: EndpointRow[]; samples?: string[]; matchedNothing?: boolean; bytesScanned?: number; clamped?: boolean }
>;

/**
 * Runs the slow-endpoints query.
 *
 * It is a form submission rather than a page load on purpose: this is the one surface whose *rendering*
 * would otherwise scan gigabytes of logs. An operator sees what it will cost, then asks for it.
 */
export async function runEndpointsAction(
  locale: string,
  connectionId: string,
  region: string,
  _prev: EndpointsState,
  formData: FormData,
): Promise<EndpointsState> {
  await requireAdmin(resolveLocale(locale));
  const db = getDb();

  const routeField = formString(formData, 'routeField').trim();
  const durationField = formString(formData, 'durationField').trim();
  if (!isSafeField(routeField) || !isSafeField(durationField)) return { error: 'invalid_field' };

  const sources = enabledLogSources(db, connectionId, region);
  if (sources.length === 0) return { error: 'no_sources' };

  // §9.5 is a hard stop, so it is checked before the query rather than after the bill.
  const budgetGb = env().OPSWATCH_LOGS_BUDGET_GB_PER_DAY;
  const nowMs = Date.now();
  if (budgetState(db, nowMs, budgetGb).exhausted) return { error: 'budget_exhausted' };

  const hours = Number(formString(formData, 'hours'));
  const windowHours = (WINDOW_CHOICES as readonly number[]).includes(hours) ? hours : 3;

  const target = await resolveTarget({ connectionId, region });
  if (!target.ok) return { error: 'query_failed' };

  const result = await runEndpointsQuery(
    target.data,
    { logGroups: sources.map((source) => source.logGroup), routeField, durationField },
    { fromMs: nowMs - windowHours * 60 * 60_000, toMs: nowMs },
  );
  if (!result.ok) return { error: 'query_failed' };

  // Recorded whatever the rows turned out to be: a scan costs its budget even when it matched nothing.
  recordScan(db, nowMs, result.data.bytesScanned);

  return {
    rows: result.data.rows,
    samples: result.data.samples,
    matchedNothing: result.data.matchedNothing,
    bytesScanned: result.data.bytesScanned,
  };
}
