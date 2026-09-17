import 'server-only';
import { DescribeDimensionKeysCommand, PIClient } from '@aws-sdk/client-pi';
import { clientConfig } from '../aws/client-config';
import { sendWithTimeout } from '../aws/timeout';
import { PI_TTL_MS } from './cache';
import { describeCall, describeTimeout, type AwsTarget, type MonitoringDeps } from './call';
import type { MonitoringResult } from './result';
import { RANGE_SECONDS, periodForRange, type TimeRange, type TimeWindow } from './shared/time-range';

export const TOP_SQL_LIMIT = 10;
export type TopSqlEntry = { id: string | null; statement: string; load: number };

const FIVE_MINUTES = 300_000;

/** PI results are cached 5 minutes, so the window end is floored to 5 minutes to keep the key stable. */
export function piWindow(range: TimeRange, nowMs: number): TimeWindow {
  const end = Math.floor(nowMs / FIVE_MINUTES) * FIVE_MINUTES;
  return { start: new Date(end - RANGE_SECONDS[range] * 1000), end: new Date(end), periodSeconds: periodForRange(range) };
}

/** The tokenized statements with the highest average active sessions (`db.load.avg`) over the window. */
export function topSql(target: AwsTarget, resourceId: string, window: TimeWindow, deps: MonitoringDeps = {}): Promise<MonitoringResult<TopSqlEntry[]>> {
  return describeCall(
    target,
    'pi:DescribeDimensionKeys',
    { resourceId, start: window.start, end: window.end, period: window.periodSeconds },
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
          GroupBy: { Group: 'db.sql_tokenized', Dimensions: ['db.sql_tokenized.id', 'db.sql_tokenized.statement'], Limit: TOP_SQL_LIMIT },
        }),
        describeTimeout(deps),
      );
      return (out.Keys ?? [])
        .map((k) => ({
          id: k.Dimensions?.['db.sql_tokenized.id'] ?? null,
          statement: k.Dimensions?.['db.sql_tokenized.statement'] ?? '',
          load: k.Total ?? 0,
        }))
        .sort((a, b) => b.load - a.load)
        .slice(0, TOP_SQL_LIMIT);
    },
    deps,
    PI_TTL_MS,
  );
}
