import 'server-only';
import type { Db } from '../db/client';
import { opswatchDbProvider } from '../history/opswatch-db';
import { RESOLUTION_MS, type HistoryPoint } from '../history/provider';
import { readHistorySettings } from '../history/settings';
import { listLoadBalancers, loadBalancerLatencyQuery, loadBalancerQueries } from '../monitoring/elb';
import { getMetricSeries, latestValue, seriesById } from '../monitoring/metrics';
import { INSIGHT_FAMILIES, loadFamily } from '../monitoring/overview';
import { recentWindow } from '../monitoring/shared/time-range';
import { resolveTarget } from '../monitoring/target';
import { JOBS } from './jobs';
import type { JobOutcome } from './runner';

/**
 * The `metrics` job: rollups, **behind the history switch** (Task 24, §31.1).
 *
 * The first thing it does is ask whether it is allowed to run at all, and on a fresh installation the answer
 * is no. That is the owner's binding ruling — a fresh install must never add AWS polling cost without an
 * explicit action — and it is enforced here rather than by remembering to configure something.
 *
 * What it writes goes through `HistoricalStorageProvider`, so an operator who points history at another
 * backend changes one setting and this job does not know the difference.
 */
export const METRICS_RESOLUTION = '5m' as const;

/**
 * How many load balancers one cycle stores availability for. §19's SLO arithmetic reads these rollups, and
 * an account with hundreds of load balancers must not turn a five-minute job into an unbounded fan-out.
 */
export const SLO_LOAD_BALANCER_LIMIT = 25;

/** The metrics §19 computes availability from: good = requests − (elb5xx + target5xx). */
const AVAILABILITY_METRICS = ['requests', 'elb5xx', 'target5xx'] as const;

/** The series a latency objective is measured on. Stored under the same subject as the availability ones. */
const LATENCY_METRIC = 'p95';

/**
 * Sums a series over the interval. `null` when CloudWatch returned no datapoint at all, which the SLO
 * arithmetic reads as an unmeasured interval rather than as zero traffic (§19, §2.4).
 */
function sumOf(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0);
}

export type MetricsJobInput = {
  db: Db;
  connectionId: string;
  scope: string;
  nowMs: number;
};

export async function runMetricsJob(input: MetricsJobInput): Promise<JobOutcome> {
  const settings = readHistorySettings(input.db);
  // Off is the default and the common case: no AWS request is made, and the run records that it did nothing.
  if (!settings.enabled) return { covered: 0, total: 0 };

  const target = await resolveTarget({ connectionId: input.connectionId, region: input.scope });
  if (!target.ok) throw new Error('connection_unavailable');

  const provider = opswatchDbProvider(input.db);
  // The interval this cycle covers, aligned so two writers agree which bucket a reading belongs to.
  const intervalStart = Math.floor(input.nowMs / RESOLUTION_MS[METRICS_RESOLUTION]) * RESOLUTION_MS[METRICS_RESOLUTION] - RESOLUTION_MS[METRICS_RESOLUTION];

  const points: HistoryPoint[] = [];
  let read = 0;
  const cap = JOBS.metrics.cap ?? Number.POSITIVE_INFINITY;

  for (const family of INSIGHT_FAMILIES) {
    if (points.length >= cap) break;
    const result = await loadFamily(family, target.data, input.nowMs);
    if (!result.ok) continue;
    read += 1;
    points.push({
      category: 'metric',
      subjectId: family,
      metric: 'affected',
      connectionId: input.connectionId,
      scope: input.scope,
      intervalStart,
      resolution: METRICS_RESOLUTION,
      // What the family actually measured. `null` would be the answer if it could not be read, and a family
      // that could not be read is skipped above rather than written as zero.
      value: result.data.affected,
      samples: 1,
    });
    points.push({
      category: 'metric',
      subjectId: family,
      metric: 'total',
      connectionId: input.connectionId,
      scope: input.scope,
      intervalStart,
      resolution: METRICS_RESOLUTION,
      value: result.data.total,
      samples: 1,
    });
  }

  // Availability rollups, which are what §19's SLO arithmetic reads back. Behind the same history switch:
  // nothing here runs on an installation that has not asked for history.
  const balancers = await listLoadBalancers(target.data);
  let lbCovered = 0;
  const lbTotal = balancers.ok ? Math.min(balancers.data.length, SLO_LOAD_BALANCER_LIMIT) : 0;

  if (balancers.ok && balancers.data.length > 0) {
    const chosen = balancers.data.slice(0, SLO_LOAD_BALANCER_LIMIT);
    const queries = chosen.flatMap((balancer, index) => loadBalancerQueries(balancer, `lb${index}`));
    const window = recentWindow(RESOLUTION_MS[METRICS_RESOLUTION] / 60_000, input.nowMs);
    const series = await getMetricSeries(target.data, queries, window);

    if (series.ok) {
      for (const [index, balancer] of chosen.entries()) {
        lbCovered += 1;
        const values: Record<(typeof AVAILABILITY_METRICS)[number], number | null> = {
          requests: sumOf(seriesById(series.data, `lb${index}req`).values),
          elb5xx: sumOf(seriesById(series.data, `lb${index}elb5xx`).values),
          target5xx: sumOf(seriesById(series.data, `lb${index}t5xx`).values),
        };
        for (const metric of AVAILABILITY_METRICS) {
          points.push({
            category: 'metric',
            subjectId: balancer.name,
            metric,
            connectionId: input.connectionId,
            scope: input.scope,
            intervalStart,
            resolution: METRICS_RESOLUTION,
            value: values[metric],
            samples: 1,
          });
        }
      }
    }

    // p95, in a request of its own: a percentile query cannot share one with a Sum query, and a latency
    // objective has nothing to measure without it. One extra request per cycle, behind the same switch.
    const latency = await getMetricSeries(
      target.data,
      chosen.map((balancer, index) => loadBalancerLatencyQuery(balancer, `lb${index}`)),
      window,
    );
    if (latency.ok) {
      for (const [index, balancer] of chosen.entries()) {
        points.push({
          category: 'metric',
          subjectId: balancer.name,
          metric: LATENCY_METRIC,
          connectionId: input.connectionId,
          scope: input.scope,
          intervalStart,
          resolution: METRICS_RESOLUTION,
          // Null when CloudWatch had no datapoint: an interval nobody measured, not an instant response.
          value: latestValue(seriesById(latency.data, `lb${index}p95`)),
          samples: 1,
        });
      }
    }
  }

  await provider.write(points, input.nowMs);
  return {
    covered: read + lbCovered,
    total: INSIGHT_FAMILIES.length + lbTotal,
    truncated: read < INSIGHT_FAMILIES.length || lbCovered < lbTotal || points.length >= cap,
  };
}
