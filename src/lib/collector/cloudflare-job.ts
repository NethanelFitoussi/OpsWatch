import 'server-only';
import { ANALYTICS_DAYS, dayKey, fetchZoneDays, type AnalyticsDeps } from '../cloudflare/analytics';
import { cloudflareIsReady, readCloudflareConnection, withCloudflareToken } from '../cloudflare/connection';
import type { Db } from '../db/client';
import { recordZoneDays } from '../store/cloudflare';
import type { JobOutcome } from './runner';

/**
 * The `cloudflare` job: what the edge saw, once every few hours (CF-2).
 *
 * **Instance-scoped, not per environment.** A Cloudflare zone belongs to the installation rather than to
 * one AWS account and region, so this runs once rather than once per environment — otherwise an operator
 * with three regions would fetch the same zone three times.
 *
 * It does nothing at all unless the token is **verified** and at least one zone is chosen. A stored token
 * nobody proved and a connection watching nothing both read nothing, and the job says it covered zero
 * rather than reporting a successful pass that did no work.
 *
 * The grain is a day, and days are re-fetched rather than appended to: Cloudflare revises recent figures,
 * so a day fetched again is a day corrected.
 */

const DAY_MS = 24 * 60 * 60_000;

export type CloudflareJobInput = { db: Db; nowMs: number };

export async function runCloudflareJob(input: CloudflareJobInput, deps: AnalyticsDeps = {}): Promise<JobOutcome> {
  if (!cloudflareIsReady(input.db)) return { covered: 0, total: 0 };
  const connection = readCloudflareConnection(input.db);
  if (connection === null) return { covered: 0, total: 0 };

  const held = withCloudflareToken(input.db);
  if (!held.ok) return { covered: 0, total: connection.zones.length };

  const since = input.nowMs - ANALYTICS_DAYS * DAY_MS;
  let covered = 0;

  for (const zone of connection.zones) {
    const result = await fetchZoneDays(held.token, zone.id, since, deps);
    // A zone that could not be read leaves its days as they were rather than being recorded as empty.
    if (!result.ok) continue;
    recordZoneDays(
      input.db,
      result.days.map((day) => ({ ...day, zoneId: zone.id })),
      input.nowMs,
    );
    covered += 1;
  }

  return { covered, total: connection.zones.length, truncated: covered < connection.zones.length };
}

/** The earliest day a read should ask about, as the API's own key. */
export function analyticsSince(nowMs: number): string {
  return dayKey(nowMs - ANALYTICS_DAYS * DAY_MS);
}
