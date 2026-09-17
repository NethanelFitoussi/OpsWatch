import 'server-only';
import { listAlarms } from './alarms';
import type { AwsTarget, MonitoringDeps } from './call';
import { listClusters, listServices, serviceTaskCountQueries, serviceUtilizationQueries, type EcsService } from './ecs';
import { listLoadBalancers, listTargetGroups, loadBalancerDimension, loadBalancerQueries, targetGroupDimension } from './elb';
import {
  albInsights,
  alarmInsights,
  ecsInsights,
  rdsInsights,
  type AlbSignals,
  type EcsClusterSignals,
  type Insight,
  type RdsInstanceSignals,
  type RuleContext,
} from './insights';
import { getMetricSeries, seriesById, type MetricQuery } from './metrics';
import { rdsMetricQueries, listDatabases, type RdsMetric } from './rds';
import type { MonitoringResult } from './result';
import { recentWindow, type TimeWindow } from './shared/time-range';

export const INSIGHT_FAMILIES = ['ecs', 'rds', 'alb', 'alarms'] as const;
export type InsightFamily = (typeof INSIGHT_FAMILIES)[number];
export type FamilySummary = { insights: Insight[]; total: number; affected: number };

/**
 * Fetched window, wider than the 15 (or 10) minutes the rules slice: CloudWatch publishes the last minutes
 * late, so a few older datapoints keep the hysteresis honest. Every family uses it, so the cards of one
 * minute share their cache keys.
 */
export const INSIGHT_FETCH_MINUTES = 20;

const RDS_INSIGHT_METRICS: RdsMetric[] = ['CPUUtilization', 'FreeableMemory'];

/**
 * The clock of one card render. Server components render once per request, so reading the clock is safe, but
 * the react-hooks purity lint forbids `Date.now()` inside a component: each card reads it here instead, and
 * the insights card reads it once for its four families so they share their cache keys.
 */
export const insightsNow = (): number => Date.now();

type Loaded = { window: TimeWindow; ctx: RuleContext };

function loaded(target: AwsTarget, nowMs: number): Loaded {
  const window = recentWindow(INSIGHT_FETCH_MINUTES, nowMs);
  // The rule context carries the scope only: credentials never reach a rule.
  return { window, ctx: { scope: { connectionId: target.connectionId, region: target.region }, now: window.end.getTime() } };
}

/** Distinct resources named by these insights; a grouped insight stands for each of its members. */
function affectedResources(insights: readonly Insight[]): number {
  return new Set(insights.flatMap((i) => (i.members ? i.members.map((m) => m.resource) : [i.resource]))).size;
}

export async function ecsFamily(target: AwsTarget, nowMs: number, deps: MonitoringDeps = {}): Promise<MonitoringResult<FamilySummary>> {
  const { window, ctx } = loaded(target, nowMs);
  const clusters = await listClusters(target, deps);
  if (!clusters.ok) return clusters;

  const lists = await Promise.all(clusters.data.map((cluster) => listServices(target, cluster.name, '', deps)));
  const listFailure = lists.find((r) => !r.ok);
  if (listFailure && !listFailure.ok) return listFailure;
  const services: EcsService[][] = lists.map((r) => (r.ok ? r.data.services : []));

  const queries = clusters.data.flatMap((cluster, c) =>
    services[c].flatMap((service, s) => {
      const prefix = `c${c}s${s}`;
      return [
        ...serviceUtilizationQueries(cluster.name, service.name, prefix),
        // Task counts only exist as metrics with Container Insights; the rules fall back to the describe counts.
        ...(cluster.containerInsights ? serviceTaskCountQueries(cluster.name, service.name, prefix) : []),
      ];
    }),
  );
  const series = await getMetricSeries(target, queries, window, deps);
  if (!series.ok) return series;

  const signals: EcsClusterSignals[] = clusters.data.map((cluster, c) => ({
    cluster: cluster.name,
    services: services[c].map((service, s) => {
      const prefix = `c${c}s${s}`;
      return {
        service,
        cpu: seriesById(series.data, `${prefix}cpu`),
        memory: seriesById(series.data, `${prefix}mem`),
        running: cluster.containerInsights ? seriesById(series.data, `${prefix}running`) : null,
        desired: cluster.containerInsights ? seriesById(series.data, `${prefix}desired`) : null,
      };
    }),
  }));

  const insights = ecsInsights(signals, ctx);
  return { ok: true, data: { insights, total: services.reduce((n, list) => n + list.length, 0), affected: affectedResources(insights) } };
}

export async function rdsFamily(target: AwsTarget, nowMs: number, deps: MonitoringDeps = {}): Promise<MonitoringResult<FamilySummary>> {
  const { window, ctx } = loaded(target, nowMs);
  const databases = await listDatabases(target, deps);
  if (!databases.ok) return databases;
  const { clusters, instances } = databases.data;
  const lagging = (instance: (typeof instances)[number]) => instance.aurora && instance.role === 'reader';

  const queries = instances.flatMap((instance, n) =>
    rdsMetricQueries(instance.id, lagging(instance) ? [...RDS_INSIGHT_METRICS, 'AuroraReplicaLag'] : RDS_INSIGHT_METRICS, `d${n}`),
  );
  const series = await getMetricSeries(target, queries, window, deps);
  if (!series.ok) return series;

  const signals: RdsInstanceSignals[] = instances.map((instance, n) => ({
    instance,
    cpu: seriesById(series.data, `d${n}CPUUtilization`),
    freeableMemory: seriesById(series.data, `d${n}FreeableMemory`),
    replicaLag: lagging(instance) ? seriesById(series.data, `d${n}AuroraReplicaLag`) : null,
  }));

  const insights = rdsInsights({ clusters, instances: signals }, ctx);
  return {
    ok: true,
    data: { insights, total: instances.length, affected: affectedResources(insights.filter((i) => i.kind === 'rds_cpu_high')) },
  };
}

export async function albFamily(target: AwsTarget, nowMs: number, deps: MonitoringDeps = {}): Promise<MonitoringResult<FamilySummary>> {
  const { window, ctx } = loaded(target, nowMs);
  const [loadBalancers, groups] = await Promise.all([listLoadBalancers(target, deps), listTargetGroups(target, null, deps)]);
  if (!loadBalancers.ok) return loadBalancers;
  if (!groups.ok) return groups;

  const byArn = new Map(loadBalancers.data.map((lb) => [lb.arn, lb]));
  // The UnHealthyHostCount dimension pair uses the group's first load balancer, so the group belongs to that one.
  const attached = groups.data.flatMap((group) => {
    const lb = byArn.get(group.loadBalancerArns[0] ?? '');
    return lb ? [{ group, lb }] : [];
  });

  const queries: MetricQuery[] = [
    ...loadBalancers.data.flatMap((lb, n) => loadBalancerQueries(lb, `l${n}`)),
    ...attached.map(({ group }, m) => ({
      id: `g${m}unhealthy`,
      namespace: 'AWS/ApplicationELB',
      metricName: 'UnHealthyHostCount',
      dimensions: { LoadBalancer: loadBalancerDimension(group.loadBalancerArns[0]), TargetGroup: targetGroupDimension(group.arn) },
      stat: 'Maximum' as const,
    })),
  ];
  const series = await getMetricSeries(target, queries, window, deps);
  if (!series.ok) return series;

  const signals: AlbSignals[] = loadBalancers.data.map((loadBalancer, n) => ({
    loadBalancer,
    requests: seriesById(series.data, `l${n}req`),
    elb5xx: seriesById(series.data, `l${n}elb5xx`),
    target5xx: seriesById(series.data, `l${n}t5xx`),
    targetGroups: attached.flatMap(({ group, lb }, m) => (lb.arn === loadBalancer.arn ? [{ group, unhealthy: seriesById(series.data, `g${m}unhealthy`) }] : [])),
  }));

  const insights = albInsights(signals, ctx);
  // Unhealthy hosts are reported but do not make a load balancer "with 5xx errors".
  const errorKinds = insights.filter((i) => i.kind === 'alb_5xx_rate' || i.kind === 'alb_elb_5xx_count');
  return { ok: true, data: { insights, total: loadBalancers.data.length, affected: affectedResources(errorKinds) } };
}

export async function alarmsFamily(target: AwsTarget, nowMs: number, deps: MonitoringDeps = {}): Promise<MonitoringResult<FamilySummary>> {
  const { ctx } = loaded(target, nowMs);
  const alarms = await listAlarms(target, deps);
  if (!alarms.ok) return alarms;
  // Target-tracking alarms fire as part of normal autoscaling, so they are counted nowhere.
  const counted = alarms.data.filter((a) => !a.targetTracking);
  return {
    ok: true,
    data: { insights: alarmInsights(alarms.data, ctx), total: counted.length, affected: counted.filter((a) => a.state === 'ALARM').length },
  };
}

const LOADERS: Record<InsightFamily, (target: AwsTarget, nowMs: number, deps?: MonitoringDeps) => Promise<MonitoringResult<FamilySummary>>> = {
  ecs: ecsFamily,
  rds: rdsFamily,
  alb: albFamily,
  alarms: alarmsFamily,
};

export function loadFamily(family: InsightFamily, target: AwsTarget, nowMs: number, deps: MonitoringDeps = {}): Promise<MonitoringResult<FamilySummary>> {
  return LOADERS[family](target, nowMs, deps);
}
