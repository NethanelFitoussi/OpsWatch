import 'server-only';
import { DescribeDimensionKeysCommand, PIClient } from '@aws-sdk/client-pi';
import { clientConfig } from '../aws/client-config';
import { sendWithTimeout } from '../aws/timeout';
import { PI_TTL_MS } from './cache';
import { describeCall, describeTimeout, type AwsTarget, type MonitoringDeps } from './call';
import type { MonitoringResult } from './result';
import { RANGE_SECONDS, periodForRange, type TimeRange, type TimeWindow } from './shared/time-range';

/** What one instance's detail page shows (amendment 2 keeps this default). */
export const TOP_SQL_LIMIT = 10;
/** What the fleet page asks each instance for before merging: deeper, because a statement heavy on one
 *  instance and mid-table on ten others only shows up if the mid-table entries were read. */
export const FLEET_SQL_LIMIT = 25;
export type TopSqlEntry = { id: string | null; statement: string; load: number };

export const PI_GROUPS = ['sql', 'user', 'host'] as const;
export type PiGroup = (typeof PI_GROUPS)[number];
/** One key of a grouping: `id` is the dimension rows merge on, `label` the readable one beside it. */
export type PiDimensionKey = { id: string | null; label: string; load: number };

/** One grouping per call (amendment 5): asking for all three would cost three calls per instance. */
const GROUP_SHAPES: Record<PiGroup, { group: string; id: string; label: string }> = {
  sql: { group: 'db.sql_tokenized', id: 'db.sql_tokenized.id', label: 'db.sql_tokenized.statement' },
  user: { group: 'db.user', id: 'db.user.id', label: 'db.user.name' },
  host: { group: 'db.host', id: 'db.host.id', label: 'db.host.name' },
};

const FIVE_MINUTES = 300_000;

/** PI results are cached 5 minutes, so the window end is floored to 5 minutes to keep the key stable. */
export function piWindow(range: TimeRange, nowMs: number): TimeWindow {
  const end = Math.floor(nowMs / FIVE_MINUTES) * FIVE_MINUTES;
  return { start: new Date(end - RANGE_SECONDS[range] * 1000), end: new Date(end), periodSeconds: periodForRange(range) };
}

/**
 * The `limit` keys of one grouping with the highest average active sessions (`db.load.avg`) over the window.
 * AWS returns at most `Limit` keys per instance, so this is that instance's top list and nothing more: it says
 * nothing about statements below its own cut-off, and a merge of several such lists is not a fleet ranking.
 */
export function topDimensionKeys(
  target: AwsTarget,
  resourceId: string,
  window: TimeWindow,
  group: PiGroup,
  limit: number,
  deps: MonitoringDeps = {},
): Promise<MonitoringResult<PiDimensionKey[]>> {
  const shape = GROUP_SHAPES[group];
  return describeCall(
    target,
    'pi:DescribeDimensionKeys',
    // The group and the limit are part of the key: two views of one instance must not share a cache entry.
    { resourceId, start: window.start, end: window.end, period: window.periodSeconds, group, limit },
    async () => {
      const client = new PIClient(clientConfig(target.region, target.credentials));
      const out = await sendWithTimeout(
        client,
        new DescribeDimensionKeysCommand({
          ServiceType: 'RDS',
          Identifier: resourceId,
          StartTime: window.start,
          EndTime: window.end,
          // The allowed PeriodInSeconds values (60, 300, 3600) are exactly `periodForRange`'s.
          PeriodInSeconds: window.periodSeconds,
          Metric: 'db.load.avg',
          GroupBy: { Group: shape.group, Dimensions: [shape.id, shape.label], Limit: limit },
        }),
        describeTimeout(deps),
      );
      return (out.Keys ?? [])
        .map((k) => ({ id: k.Dimensions?.[shape.id] ?? null, label: k.Dimensions?.[shape.label] ?? '', load: k.Total ?? 0 }))
        .sort((a, b) => b.load - a.load)
        .slice(0, limit);
    },
    deps,
    PI_TTL_MS,
  );
}

/** The instance detail page's view: tokenized statements only, top 10. */
export async function topSql(target: AwsTarget, resourceId: string, window: TimeWindow, deps: MonitoringDeps = {}): Promise<MonitoringResult<TopSqlEntry[]>> {
  const keys = await topDimensionKeys(target, resourceId, window, 'sql', TOP_SQL_LIMIT, deps);
  return keys.ok ? { ok: true, data: keys.data.map((k) => ({ id: k.id, statement: k.label, load: k.load })) } : keys;
}
