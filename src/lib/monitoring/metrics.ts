import 'server-only';
import { CloudWatchClient, GetMetricDataCommand, type MetricDataQuery } from '@aws-sdk/client-cloudwatch';
import { clientConfig } from '../aws/client-config';
import { sendWithTimeout } from '../aws/timeout';
import { METRICS_TTL_MS, cacheKey, monitoringCache } from './cache';
import { chunk, runCall, type AwsTarget, type MonitoringDeps } from './call';
import type { MonitoringResult } from './result';
import type { TimeWindow } from './shared/time-range';

export const MAX_QUERIES_PER_CALL = 500;
export const METRICS_TIMEOUT_MS = 10_000;
const MAX_PAGES = 20;
const ACTION = 'cloudwatch:GetMetricData';

export type MetricStatName = 'Average' | 'Sum' | 'Maximum' | 'Minimum' | 'p95';
export type MetricQuery = { id: string; namespace: string; metricName: string; dimensions: Record<string, string>; stat: MetricStatName; label?: string };
export type SeriesData = { timestamps: number[]; values: number[] };
export type MetricSeries = SeriesData & { id: string; label: string };

const EMPTY: SeriesData = { timestamps: [], values: [] };

function awsQuery(query: MetricQuery, id: string, periodSeconds: number): MetricDataQuery {
  return {
    Id: id,
    ReturnData: true,
    MetricStat: {
      Metric: {
        Namespace: query.namespace,
        MetricName: query.metricName,
        // Sorted by name: CloudWatch does not care, moto does (fact 4), and cache keys stay stable.
        Dimensions: Object.entries(query.dimensions).sort(([a], [b]) => (a < b ? -1 : 1)).map(([Name, Value]) => ({ Name, Value })),
      },
      Period: periodSeconds,
      Stat: query.stat,
    },
  };
}

function ascending(series: SeriesData): SeriesData {
  const byTime = new Map<number, number>();
  series.timestamps.forEach((t, i) => byTime.set(t, series.values[i]));
  const timestamps = [...byTime.keys()].sort((a, b) => a - b);
  return { timestamps, values: timestamps.map((t) => byTime.get(t) as number) };
}

type Pending = { key: string; query: MetricQuery };

async function fetchBatch(client: CloudWatchClient, batch: Pending[], window: TimeWindow, timeoutMs: number): Promise<Map<string, SeriesData>> {
  const collected = batch.map(() => ({ timestamps: [] as number[], values: [] as number[] }));
  let NextToken: string | undefined;
  let pages = 0;
  do {
    const out = await sendWithTimeout(
      client,
      new GetMetricDataCommand({
        StartTime: window.start,
        EndTime: window.end,
        ScanBy: 'TimestampAscending',
        MetricDataQueries: batch.map((p, i) => awsQuery(p.query, `q${i}`, window.periodSeconds)),
        ...(NextToken ? { NextToken } : {}),
      }),
      timeoutMs,
    );
    for (const r of out.MetricDataResults ?? []) {
      const index = Number(r.Id?.slice(1));
      const target = r.Id?.startsWith('q') ? collected[index] : undefined;
      if (!target) continue;
      target.timestamps.push(...(r.Timestamps ?? []).map((d) => d.getTime()));
      target.values.push(...(r.Values ?? []));
    }
    NextToken = out.NextToken;
    pages += 1;
  } while (NextToken && pages < MAX_PAGES);
  return new Map(batch.map((p, i) => [p.key, ascending(collected[i])]));
}

export async function getMetricSeries(target: AwsTarget, queries: readonly MetricQuery[], window: TimeWindow, deps: MonitoringDeps = {}): Promise<MonitoringResult<MetricSeries[]>> {
  const cache = deps.cache ?? monitoringCache;
  const timeoutMs = deps.timeoutMs ?? METRICS_TIMEOUT_MS;
  const keyOf = (q: MetricQuery) =>
    cacheKey(target, ACTION, { namespace: q.namespace, metricName: q.metricName, dimensions: q.dimensions, stat: q.stat, period: window.periodSeconds, start: window.start, end: window.end });

  const pending = new Map<string, Promise<MonitoringResult<SeriesData>>>();
  const missedKeys = new Set<string>();
  const misses: Pending[] = [];
  for (const query of queries) {
    const key = keyOf(query);
    if (pending.has(key) || missedKeys.has(key)) continue;
    const hit = cache.get<MonitoringResult<SeriesData>>(key);
    if (hit) pending.set(key, hit);
    else {
      missedKeys.add(key);
      misses.push({ key, query });
    }
  }

  if (misses.length > 0) {
    const client = new CloudWatchClient(clientConfig(target.region, target.credentials));
    for (const batch of chunk(misses, MAX_QUERIES_PER_CALL)) {
      const batchResult = runCall(target, ACTION, () => fetchBatch(client, batch, window, timeoutMs), deps);
      for (const { key } of batch) {
        const one = batchResult.then((r): MonitoringResult<SeriesData> => (r.ok ? { ok: true, data: r.data.get(key) ?? EMPTY } : r));
        cache.set(key, one, METRICS_TTL_MS);
        pending.set(key, one);
      }
    }
  }

  const results = await Promise.all(queries.map((q) => pending.get(keyOf(q)) as Promise<MonitoringResult<SeriesData>>));
  const failure = results.find((r) => !r.ok);
  if (failure && !failure.ok) return failure;
  return {
    ok: true,
    data: queries.map((q, i) => {
      const r = results[i];
      return { id: q.id, label: q.label ?? q.metricName, ...(r.ok ? r.data : EMPTY) };
    }),
  };
}

export function seriesById(series: readonly MetricSeries[], id: string): SeriesData {
  const found = series.find((s) => s.id === id);
  return found ? { timestamps: found.timestamps, values: found.values } : EMPTY;
}

export function latestValue(series: SeriesData): number | null {
  return series.values.length > 0 ? series.values[series.values.length - 1] : null;
}
