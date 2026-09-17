import 'server-only';
import { DescribeTargetGroupsCommand, DescribeTargetHealthCommand, ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';
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

export const DESCRIBE_TARGET_GROUPS_BATCH = 20;

const NAMESPACE = 'AWS/ApplicationELB';
const elbClient = (target: AwsTarget) => new ElasticLoadBalancingV2Client(clientConfig(target.region, target.credentials));

/** `…:loadbalancer/app/api/50dc…` → `app/api/50dc…` (the `LoadBalancer` dimension). */
export const loadBalancerDimension = (arn: string) => arn.split(':loadbalancer/')[1] ?? arn;
/** `…:targetgroup/web/73e2…` → `targetgroup/web/73e2…` (the `TargetGroup` dimension). */
export const targetGroupDimension = (arn: string) => arn.slice(arn.lastIndexOf(':') + 1);

export async function describeTargetGroups(target: AwsTarget, arns: readonly string[], deps: MonitoringDeps = {}): Promise<MonitoringResult<TargetGroup[]>> {
  const batches = await Promise.all(
    chunk(arns, DESCRIBE_TARGET_GROUPS_BATCH).map((batch) =>
      describeCall(target, 'elasticloadbalancing:DescribeTargetGroups', { arns: batch }, async () => {
        try {
          const out = await sendWithTimeout(elbClient(target), new DescribeTargetGroupsCommand({ TargetGroupArns: batch }), describeTimeout(deps));
          return (out.TargetGroups ?? []).map(
            (g): TargetGroup => ({
              name: g.TargetGroupName ?? '',
              arn: g.TargetGroupArn ?? '',
              protocol: g.Protocol ?? null,
              port: g.Port ?? null,
              targetType: g.TargetType ?? null,
              healthCheckPath: g.HealthCheckPath ?? null,
              loadBalancerArns: g.LoadBalancerArns ?? [],
            }),
          );
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
