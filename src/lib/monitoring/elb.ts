import 'server-only';
import {
  DescribeLoadBalancersCommand,
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
  ElasticLoadBalancingV2Client,
  type LoadBalancer as SdkLoadBalancer,
  type TargetGroup as SdkTargetGroup,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { clientConfig } from '../aws/client-config';
import { sendWithTimeout } from '../aws/timeout';
import { chunk, describeCall, describeTimeout, type AwsTarget, type MonitoringDeps } from './call';
import type { MetricQuery } from './metrics';
import type { MonitoringResult } from './result';

export type TargetGroup = {
  name: string;
  arn: string;
  protocol: string | null;
  port: number | null;
  targetType: string | null;
  healthCheckPath: string | null;
  loadBalancerArns: string[];
};
export type TargetHealthEntry = { id: string; port: number | null; state: string; reason: string | null; description: string | null };
export type LoadBalancer = {
  name: string;
  arn: string;
  dimension: string;
  dnsName: string | null;
  scheme: string | null;
  state: string | null;
  vpcId: string | null;
  createdAt: number | null;
};

export const DESCRIBE_TARGET_GROUPS_BATCH = 20;
/** Target health is fetched per target group: capped so a region with many groups cannot fan out unbounded describe calls. */
export const MAX_TARGET_GROUPS_WITH_HEALTH = 50;

const NAMESPACE = 'AWS/ApplicationELB';
const DESCRIBE_PAGE_SIZE = 400;
const MAX_DESCRIBE_PAGES = 50;
const elbClient = (target: AwsTarget) => new ElasticLoadBalancingV2Client(clientConfig(target.region, target.credentials));

/** `…:loadbalancer/app/api/50dc…` → `app/api/50dc…` (the `LoadBalancer` dimension). */
export const loadBalancerDimension = (arn: string) => arn.split(':loadbalancer/')[1] ?? arn;
/** `…:targetgroup/web/73e2…` → `targetgroup/web/73e2…` (the `TargetGroup` dimension). */
export const targetGroupDimension = (arn: string) => arn.slice(arn.lastIndexOf(':') + 1);

function mapLoadBalancer(lb: SdkLoadBalancer): LoadBalancer {
  const arn = lb.LoadBalancerArn ?? '';
  return {
    name: lb.LoadBalancerName ?? '',
    arn,
    dimension: loadBalancerDimension(arn),
    dnsName: lb.DNSName ?? null,
    scheme: lb.Scheme ?? null,
    state: lb.State?.Code ?? null,
    vpcId: lb.VpcId ?? null,
    createdAt: lb.CreatedTime ? lb.CreatedTime.getTime() : null,
  };
}

function mapTargetGroup(g: SdkTargetGroup): TargetGroup {
  return {
    name: g.TargetGroupName ?? '',
    arn: g.TargetGroupArn ?? '',
    protocol: g.Protocol ?? null,
    port: g.Port ?? null,
    targetType: g.TargetType ?? null,
    healthCheckPath: g.HealthCheckPath ?? null,
    loadBalancerArns: g.LoadBalancerArns ?? [],
  };
}

/** Lists the application load balancers of the region (network and gateway load balancers are dropped). */
export function listLoadBalancers(target: AwsTarget, deps: MonitoringDeps = {}): Promise<MonitoringResult<LoadBalancer[]>> {
  return describeCall(target, 'elasticloadbalancing:DescribeLoadBalancers', {}, async () => {
    const client = elbClient(target);
    const items: SdkLoadBalancer[] = [];
    let Marker: string | undefined;
    let pages = 0;
    do {
      const out = await sendWithTimeout(
        client,
        new DescribeLoadBalancersCommand({ PageSize: DESCRIBE_PAGE_SIZE, ...(Marker ? { Marker } : {}) }),
        describeTimeout(deps),
      );
      items.push(...(out.LoadBalancers ?? []));
      Marker = out.NextMarker;
      pages += 1;
    } while (Marker && pages < MAX_DESCRIBE_PAGES);
    return items
      .filter((lb) => lb.Type === 'application')
      .map(mapLoadBalancer)
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  }, deps);
}

/** A single load balancer by name, or `null` when it does not exist or is not an application load balancer. */
export function findLoadBalancer(target: AwsTarget, name: string, deps: MonitoringDeps = {}): Promise<MonitoringResult<LoadBalancer | null>> {
  return describeCall(target, 'elasticloadbalancing:DescribeLoadBalancers', { name }, async () => {
    try {
      const out = await sendWithTimeout(elbClient(target), new DescribeLoadBalancersCommand({ Names: [name] }), describeTimeout(deps));
      const lb = (out.LoadBalancers ?? [])[0];
      return lb && lb.Type === 'application' ? mapLoadBalancer(lb) : null;
    } catch (error) {
      if ((error as { name?: string }).name === 'LoadBalancerNotFoundException') return null;
      throw error;
    }
  }, deps);
}

/** All target groups, or only those of one load balancer when `loadBalancerArn` is given. */
export function listTargetGroups(target: AwsTarget, loadBalancerArn: string | null, deps: MonitoringDeps = {}): Promise<MonitoringResult<TargetGroup[]>> {
  return describeCall(target, 'elasticloadbalancing:DescribeTargetGroups', { loadBalancerArn }, async () => {
    const client = elbClient(target);
    const items: SdkTargetGroup[] = [];
    let Marker: string | undefined;
    let pages = 0;
    do {
      const out = await sendWithTimeout(
        client,
        new DescribeTargetGroupsCommand({
          PageSize: DESCRIBE_PAGE_SIZE,
          ...(loadBalancerArn ? { LoadBalancerArn: loadBalancerArn } : {}),
          ...(Marker ? { Marker } : {}),
        }),
        describeTimeout(deps),
      );
      items.push(...(out.TargetGroups ?? []));
      Marker = out.NextMarker;
      pages += 1;
    } while (Marker && pages < MAX_DESCRIBE_PAGES);
    return items.map(mapTargetGroup).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  }, deps);
}

/** The load balancer's own traffic and error metrics (dimension `LoadBalancer` only, no target group). */
export function loadBalancerQueries(lb: LoadBalancer, idPrefix: string): MetricQuery[] {
  const dimensions = { LoadBalancer: lb.dimension };
  return [
    { id: `${idPrefix}req`, namespace: NAMESPACE, metricName: 'RequestCount', dimensions, stat: 'Sum' },
    { id: `${idPrefix}elb5xx`, namespace: NAMESPACE, metricName: 'HTTPCode_ELB_5XX_Count', dimensions, stat: 'Sum' },
    { id: `${idPrefix}t5xx`, namespace: NAMESPACE, metricName: 'HTTPCode_Target_5XX_Count', dimensions, stat: 'Sum' },
  ];
}

/** Sent in its own GetMetricData request: percentile queries never share a request (moto fact 2). */
export function loadBalancerLatencyQuery(lb: LoadBalancer, idPrefix: string): MetricQuery {
  return { id: `${idPrefix}p95`, namespace: NAMESPACE, metricName: 'TargetResponseTime', dimensions: { LoadBalancer: lb.dimension }, stat: 'p95' };
}

/** Healthy and unhealthy target counts across one or more target groups' `DescribeTargetHealth` results. */
export function targetHealthCounts(entries: readonly TargetHealthEntry[]): { healthy: number; unhealthy: number } {
  return {
    healthy: entries.filter((e) => e.state === 'healthy').length,
    unhealthy: entries.filter((e) => e.state === 'unhealthy').length,
  };
}

export async function describeTargetGroups(target: AwsTarget, arns: readonly string[], deps: MonitoringDeps = {}): Promise<MonitoringResult<TargetGroup[]>> {
  const batches = await Promise.all(
    chunk(arns, DESCRIBE_TARGET_GROUPS_BATCH).map((batch) =>
      describeCall(target, 'elasticloadbalancing:DescribeTargetGroups', { arns: batch }, async () => {
        try {
          const out = await sendWithTimeout(elbClient(target), new DescribeTargetGroupsCommand({ TargetGroupArns: batch }), describeTimeout(deps));
          return (out.TargetGroups ?? []).map(mapTargetGroup);
        } catch (error) {
          if ((error as { name?: string }).name === 'TargetGroupNotFoundException') return [];
          throw error;
        }
      }, deps),
    ),
  );
  const failure = batches.find((b) => !b.ok);
  if (failure && !failure.ok) return failure;
  return { ok: true, data: batches.flatMap((b) => (b.ok ? b.data : [])).sort((a, b) => a.name.localeCompare(b.name, 'en')) };
}

export function targetHealth(target: AwsTarget, targetGroupArn: string, deps: MonitoringDeps = {}): Promise<MonitoringResult<TargetHealthEntry[]>> {
  return describeCall(target, 'elasticloadbalancing:DescribeTargetHealth', { targetGroupArn }, async () => {
    const out = await sendWithTimeout(elbClient(target), new DescribeTargetHealthCommand({ TargetGroupArn: targetGroupArn }), describeTimeout(deps));
    return (out.TargetHealthDescriptions ?? []).map((d) => ({
      id: d.Target?.Id ?? '',
      port: d.Target?.Port ?? null,
      state: d.TargetHealth?.State ?? '',
      reason: d.TargetHealth?.Reason ?? null,
      description: d.TargetHealth?.Description ?? null,
    }));
  }, deps);
}

function targetGroupDimensions(group: TargetGroup): Record<string, string> | null {
  const loadBalancerArn = group.loadBalancerArns[0];
  return loadBalancerArn ? { LoadBalancer: loadBalancerDimension(loadBalancerArn), TargetGroup: targetGroupDimension(group.arn) } : null;
}

/** Target group metrics exist only per load balancer: none when the group is not attached. */
export function targetGroupQueries(group: TargetGroup, idPrefix: string): MetricQuery[] {
  const dimensions = targetGroupDimensions(group);
  if (!dimensions) return [];
  return [
    { id: `${idPrefix}req`, namespace: NAMESPACE, metricName: 'RequestCount', dimensions, stat: 'Sum' },
    { id: `${idPrefix}t5xx`, namespace: NAMESPACE, metricName: 'HTTPCode_Target_5XX_Count', dimensions, stat: 'Sum' },
    { id: `${idPrefix}healthy`, namespace: NAMESPACE, metricName: 'HealthyHostCount', dimensions, stat: 'Average' },
    { id: `${idPrefix}unhealthy`, namespace: NAMESPACE, metricName: 'UnHealthyHostCount', dimensions, stat: 'Maximum' },
  ];
}

/** Sent in its own GetMetricData request: percentile queries never share a request (moto fact 2). */
export function targetGroupLatencyQuery(group: TargetGroup, idPrefix: string): MetricQuery | null {
  const dimensions = targetGroupDimensions(group);
  return dimensions ? { id: `${idPrefix}p95`, namespace: NAMESPACE, metricName: 'TargetResponseTime', dimensions, stat: 'p95' } : null;
}
