import 'server-only';
import type { AlarmSummary } from './alarms';
import type { EcsService } from './ecs';
import type { LoadBalancer, TargetGroup } from './elb';
import { MIN_CONSECUTIVE, average, breachActive, sliceSince, sum, thresholdLevel, type Levels } from './evaluate';
import type { SeriesData } from './metrics';
import type { RdsCluster, RdsInstance } from './rds';
import { formatMetricValue, type MetricUnit } from './shared/format';
import { monitoringPath, type ScopeRef } from './shared/paths';

export type InsightSeverity = 'critical' | 'warning' | 'info';
export type InsightKind =
  | 'ecs_tasks_below_desired'
  | 'ecs_cpu_high'
  | 'ecs_memory_high'
  | 'ecs_rollout_failed'
  | 'ecs_rollout_stuck'
  | 'rds_cpu_high'
  | 'rds_freeable_memory_low'
  | 'aurora_replica_lag'
  | 'alb_5xx_rate'
  | 'alb_elb_5xx_count'
  | 'alb_unhealthy_hosts'
  | 'alarm_firing';
export type InsightValues = Record<string, string | number>;
export type InsightMember = { resource: string; severity: InsightSeverity; messageKey: string; values: InsightValues; href: string };
export type Insight = {
  severity: InsightSeverity;
  kind: InsightKind;
  resource: string;
  messageKey: string;
  values: InsightValues;
  href: string;
  members?: InsightMember[];
};
/** `now` is the end of the evaluation window (epoch ms): the rules never read the clock themselves. */
export type RuleContext = { scope: ScopeRef; now: number };

export const INSIGHT_WINDOW_MINUTES = 15;
export const TASKS_WINDOW_MINUTES = 10;
export const ROLLOUT_STUCK_MINUTES = 30;
/** More than three service insights of one kind in a cluster collapse into one grouped insight. */
export const GROUP_MIN_SERVICES = 4;

export const ECS_UTILIZATION_LEVELS: Levels = { warning: { threshold: 85, clearAt: 80 }, critical: { threshold: 95, clearAt: 90 } };
export const RDS_CPU_LEVELS: Levels = { warning: { threshold: 80, clearAt: 75 }, critical: { threshold: 95, clearAt: 90 } };
export const FREEABLE_MEMORY_LEVELS: Levels = { warning: { threshold: 5, clearAt: 10 } };
/** Milliseconds: the clearing margin is 5 % of the threshold, since "5 points below" is meaningless here. */
export const REPLICA_LAG_LEVELS: Levels = { warning: { threshold: 1000, clearAt: 950 } };
export const ALB_5XX_RATE_LEVELS = { warning: { threshold: 1, clearAt: 0.95 }, critical: { threshold: 5, clearAt: 4.75 } } as const;
export const ALB_MIN_REQUESTS = 100;
export const ALB_ELB_5XX_COUNT = { warning: 10, critical: 100 };
export const UNHEALTHY_HOSTS_LEVELS: Levels = { warning: { threshold: 0, clearAt: 0 } };

export type EcsServiceSignals = { service: EcsService; cpu: SeriesData; memory: SeriesData; running: SeriesData | null; desired: SeriesData | null };
export type EcsClusterSignals = { cluster: string; services: EcsServiceSignals[] };
export type RdsInstanceSignals = { instance: RdsInstance; cpu: SeriesData; freeableMemory: SeriesData; replicaLag: SeriesData | null };
export type AlbSignals = {
  loadBalancer: LoadBalancer;
  requests: SeriesData;
  elb5xx: SeriesData;
  target5xx: SeriesData;
  targetGroups: { group: TargetGroup; unhealthy: SeriesData }[];
};

const SEVERITY_RANK: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2 };
const minutesAgo = (ctx: RuleContext, minutes: number) => ctx.now - minutes * 60_000;
const levelThreshold = (levels: Levels, level: 'critical' | 'warning') => (levels[level] ?? levels.warning).threshold;
const byTimestamp = (series: SeriesData) => new Map(series.timestamps.map((t, i) => [t, series.values[i]]));
const byResource = (a: { resource: string }, b: { resource: string }) => a.resource.localeCompare(b.resource, 'en');
const highestSeverity = (members: readonly { severity: InsightSeverity }[]): InsightSeverity =>
  members.reduce<InsightSeverity>((best, m) => (SEVERITY_RANK[m.severity] < SEVERITY_RANK[best] ? m.severity : best), 'info');
const toMember = ({ resource, severity, messageKey, values, href }: Insight): InsightMember => ({ resource, severity, messageKey, values, href });

// --- ECS ---------------------------------------------------------------------------------------

/** Running/desired datapoints that share a timestamp inside the window, oldest first. */
function alignedPairs(running: SeriesData, desired: SeriesData, since: number): [number, number][] {
  const wanted = byTimestamp(desired);
  return running.timestamps.flatMap((t, i) => {
    const want = wanted.get(t);
    return t >= since && want !== undefined ? [[running.values[i], want] as [number, number]] : [];
  });
}

function ecsServiceInsights(cluster: string, s: EcsServiceSignals, ctx: RuleContext): Insight[] {
  const name = s.service.name;
  const href = monitoringPath(ctx.scope, 'containers', cluster, name);
  const out: Insight[] = [];
  const make = (severity: InsightSeverity, kind: InsightKind, values: InsightValues): Insight => ({
    severity,
    kind,
    resource: name,
    messageKey: `messages.${kind}`,
    values: { service: name, ...values },
    href,
  });

  const pairs = s.running && s.desired ? alignedPairs(s.running, s.desired, minutesAgo(ctx, TASKS_WINDOW_MINUTES)) : [];
  if (pairs.length >= MIN_CONSECUTIVE) {
    if (pairs.every(([r, d]) => r < d)) {
      const [r, d] = pairs[pairs.length - 1];
      out.push(make('critical', 'ecs_tasks_below_desired', { running: Math.round(r), desired: Math.round(d) }));
    }
  } else {
    // No Container Insights: trust the describe counts, but only once they have been stale for the whole window.
    const updatedAt = s.service.primaryDeployment?.updatedAt;
    if (s.service.runningCount < s.service.desiredCount && updatedAt != null && updatedAt <= minutesAgo(ctx, TASKS_WINDOW_MINUTES)) {
      out.push(make('critical', 'ecs_tasks_below_desired', { running: s.service.runningCount, desired: s.service.desiredCount }));
    }
  }

  const since = minutesAgo(ctx, INSIGHT_WINDOW_MINUTES);
  for (const [kind, data] of [
    ['ecs_cpu_high', s.cpu],
    ['ecs_memory_high', s.memory],
  ] as const) {
    const window = sliceSince(data, since);
    const level = thresholdLevel(window, ECS_UTILIZATION_LEVELS, 'above');
    if (level) out.push(make(level, kind, { value: average(window.values) as number, threshold: levelThreshold(ECS_UTILIZATION_LEVELS, level) }));
  }

  const deployment = s.service.primaryDeployment;
  if (deployment?.rolloutState === 'FAILED') out.push(make('critical', 'ecs_rollout_failed', { reason: deployment.rolloutStateReason ?? '' }));
  if (deployment?.rolloutState === 'IN_PROGRESS' && deployment.createdAt != null && deployment.createdAt <= minutesAgo(ctx, ROLLOUT_STUCK_MINUTES)) {
    out.push(make('warning', 'ecs_rollout_stuck', { minutes: Math.floor((ctx.now - deployment.createdAt) / 60_000) }));
  }
  return out;
}

export function ecsInsights(clusters: readonly EcsClusterSignals[], ctx: RuleContext): Insight[] {
  return clusters.flatMap(({ cluster, services }) => {
    const all = services.flatMap((s) => ecsServiceInsights(cluster, s, ctx));
    const byKind = Map.groupBy(all, (insight) => insight.kind);
    return [...byKind.entries()].flatMap(([kind, list]): Insight[] => {
      if (list.length < GROUP_MIN_SERVICES) return list;
      const members = list.map(toMember).sort(byResource);
      return [
        {
          severity: highestSeverity(members),
          kind,
          resource: cluster,
          messageKey: `groups.${kind}`,
          values: { cluster, count: list.length },
          href: monitoringPath(ctx.scope, 'containers'),
          members,
        },
      ];
    });
  });
}

// --- RDS ---------------------------------------------------------------------------------------

function rdsInstanceInsights(s: RdsInstanceSignals, ctx: RuleContext): Insight[] {
  const id = s.instance.id;
  const href = monitoringPath(ctx.scope, 'databases', id);
  const since = minutesAgo(ctx, INSIGHT_WINDOW_MINUTES);
  const out: Insight[] = [];
  const make = (severity: InsightSeverity, kind: InsightKind, values: InsightValues): Insight => ({
    severity,
    kind,
    resource: id,
    messageKey: `messages.${kind}`,
    values: { instance: id, ...values },
    href,
  });

  const cpu = sliceSince(s.cpu, since);
  const cpuLevel = thresholdLevel(cpu, RDS_CPU_LEVELS, 'above');
  if (cpuLevel) out.push(make(cpuLevel, 'rds_cpu_high', { value: average(cpu.values) as number, threshold: levelThreshold(RDS_CPU_LEVELS, cpuLevel) }));

  // FreeableMemory is absolute: it only means something as a share of the instance's memory.
  if (s.instance.memoryGiB != null) {
    const total = s.instance.memoryGiB * 1024 ** 3;
    const bytes = sliceSince(s.freeableMemory, since);
    const percent: SeriesData = { timestamps: bytes.timestamps, values: bytes.values.map((v) => (v / total) * 100) };
    const level = thresholdLevel(percent, FREEABLE_MEMORY_LEVELS, 'below');
    if (level) out.push(make(level, 'rds_freeable_memory_low', { value: average(percent.values) as number }));
  }
  return out;
}

/** Replica lag is always grouped: a lagging Aurora cluster with nine readers must not produce nine insights. */
function replicaLagInsights(clusters: readonly RdsCluster[], instances: readonly RdsInstanceSignals[], ctx: RuleContext): Insight[] {
  const since = minutesAgo(ctx, INSIGHT_WINDOW_MINUTES);
  const readers = new Map<string, { id: string; lag: SeriesData }[]>();
  for (const id of clusters.map((c) => c.id)) readers.set(id, []);
  for (const { instance, replicaLag } of instances) {
    const clusterId = instance.clusterId;
    if (!instance.aurora || instance.role !== 'reader' || replicaLag === null || clusterId === null) continue;
    readers.set(clusterId, [...(readers.get(clusterId) ?? []), { id: instance.id, lag: replicaLag }]);
  }

  return [...readers.entries()].flatMap(([cluster, list]): Insight[] => {
    const members = list.flatMap((s): InsightMember[] => {
      const window = sliceSince(s.lag, since);
      if (thresholdLevel(window, REPLICA_LAG_LEVELS, 'above') !== 'warning') return [];
      return [
        {
          resource: s.id,
          severity: 'warning',
          messageKey: 'members.aurora_replica_lag',
          values: { instance: s.id, value: average(window.values) as number },
          href: monitoringPath(ctx.scope, 'databases', s.id),
        },
      ];
    });
    if (members.length === 0) return [];
    return [
      {
        severity: 'warning',
        kind: 'aurora_replica_lag',
        resource: cluster,
        messageKey: 'messages.aurora_replica_lag',
        values: { cluster, lagging: members.length, readers: list.length },
        href: monitoringPath(ctx.scope, 'databases'),
        members: members.sort(byResource),
      },
    ];
  });
}

export function rdsInsights(input: { clusters: readonly RdsCluster[]; instances: readonly RdsInstanceSignals[] }, ctx: RuleContext): Insight[] {
  return [...input.instances.flatMap((s) => rdsInstanceInsights(s, ctx)), ...replicaLagInsights(input.clusters, input.instances, ctx)];
}

// --- Load balancers ----------------------------------------------------------------------------

function albRateInsight(s: AlbSignals, ctx: RuleContext, since: number): Insight[] {
  const requests = sliceSince(s.requests, since);
  const elb = sliceSince(s.elb5xx, since);
  const target = sliceSince(s.target5xx, since);
  const total = sum(requests.values);
  // A handful of requests makes any percentage meaningless.
  if (total < ALB_MIN_REQUESTS) return [];
  const errors = sum(elb.values) + sum(target.values);
  const rate = (errors / total) * 100;
  const elbAt = byTimestamp(elb);
  const targetAt = byTimestamp(target);
  // Per-minute rates on the request timestamps: a minute without a 5xx datapoint had no errors.
  const rates = requests.timestamps.flatMap((t, i) =>
    requests.values[i] > 0 ? [(((elbAt.get(t) ?? 0) + (targetAt.get(t) ?? 0)) / requests.values[i]) * 100] : [],
  );
  const severity: InsightSeverity | null =
    rate > ALB_5XX_RATE_LEVELS.critical.threshold && breachActive(rates, ALB_5XX_RATE_LEVELS.critical, 'above')
      ? 'critical'
      : rate > ALB_5XX_RATE_LEVELS.warning.threshold && breachActive(rates, ALB_5XX_RATE_LEVELS.warning, 'above')
        ? 'warning'
        : null;
  if (!severity) return [];
  return [
    {
      severity,
      kind: 'alb_5xx_rate',
      resource: s.loadBalancer.name,
      messageKey: 'messages.alb_5xx_rate',
      values: { loadBalancer: s.loadBalancer.name, rate, errors, requests: total },
      href: monitoringPath(ctx.scope, 'load-balancers', s.loadBalancer.name),
    },
  ];
}

export function albInsights(input: readonly AlbSignals[], ctx: RuleContext): Insight[] {
  const since = minutesAgo(ctx, INSIGHT_WINDOW_MINUTES);
  return input.flatMap((s): Insight[] => {
    const name = s.loadBalancer.name;
    const href = monitoringPath(ctx.scope, 'load-balancers', name);
    const out = albRateInsight(s, ctx, since);

    // Independent of RequestCount: errors the load balancer returned itself never reached a target.
    const count = sum(sliceSince(s.elb5xx, since).values);
    const countSeverity: InsightSeverity | null =
      count >= ALB_ELB_5XX_COUNT.critical ? 'critical' : count >= ALB_ELB_5XX_COUNT.warning ? 'warning' : null;
    if (countSeverity) {
      out.push({
        severity: countSeverity,
        kind: 'alb_elb_5xx_count',
        resource: name,
        messageKey: 'messages.alb_elb_5xx_count',
        values: { loadBalancer: name, count },
        href,
      });
    }

    for (const { group, unhealthy } of s.targetGroups) {
      const window = sliceSince(unhealthy, since);
      const level = thresholdLevel(window, UNHEALTHY_HOSTS_LEVELS, 'above');
      if (!level) continue;
      out.push({
        severity: level,
        kind: 'alb_unhealthy_hosts',
        resource: `${name}/${group.name}`,
        messageKey: 'messages.alb_unhealthy_hosts',
        values: { loadBalancer: name, targetGroup: group.name, count: Math.round(Math.max(...window.values)) },
        href,
      });
    }
    return out;
  });
}

// --- Alarms ------------------------------------------------------------------------------------

/** Target-tracking alarms fire as part of normal autoscaling, so they are never an insight. */
export function alarmInsights(alarms: readonly AlarmSummary[], ctx: RuleContext): Insight[] {
  return alarms
    .filter((a) => a.state === 'ALARM' && !a.targetTracking)
    .map((a) => ({
      severity: 'critical' as const,
      kind: 'alarm_firing' as const,
      resource: a.name,
      messageKey: 'messages.alarm_firing',
      values: { alarm: a.name },
      href: `${monitoringPath(ctx.scope, 'alarms')}?state=ALARM`,
    }));
}

// --- Presentation ------------------------------------------------------------------------------

export function sortInsights(insights: readonly Insight[]): Insight[] {
  return [...insights].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.kind.localeCompare(b.kind, 'en') || byResource(a, b),
  );
}

/** Only these values are pre-formatted; counts stay numbers so ICU plurals still work. */
export const INSIGHT_VALUE_UNITS: Record<string, Record<string, MetricUnit>> = {
  'messages.ecs_cpu_high': { value: 'percent', threshold: 'percent' },
  'messages.ecs_memory_high': { value: 'percent', threshold: 'percent' },
  'messages.rds_cpu_high': { value: 'percent', threshold: 'percent' },
  'messages.rds_freeable_memory_low': { value: 'percent' },
  'messages.alb_5xx_rate': { rate: 'percent' },
  'members.aurora_replica_lag': { value: 'milliseconds' },
};

export function formatInsightValues(messageKey: string, values: InsightValues, locale: string): InsightValues {
  const units = INSIGHT_VALUE_UNITS[messageKey];
  if (!units) return values;
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      const unit = units[key];
      return [key, unit !== undefined && typeof value === 'number' ? formatMetricValue(value, unit, locale) : value];
    }),
  );
}
