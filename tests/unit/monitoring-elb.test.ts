import { DescribeTargetGroupsCommand, DescribeTargetHealthCommand, ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createTtlCache } from '@/lib/monitoring/cache';
import {
  DESCRIBE_TARGET_GROUPS_BATCH,
  describeTargetGroups,
  loadBalancerDimension,
  targetGroupDimension,
  targetGroupLatencyQuery,
  targetGroupQueries,
  targetHealth,
  type TargetGroup,
} from '@/lib/monitoring/elb';

const elb = mockClient(ElasticLoadBalancingV2Client);
const target = { connectionId: 'abc123def456', region: 'eu-west-1', credentials: { accessKeyId: 'ASIA', secretAccessKey: 's' } };
const lbArn = 'arn:aws:elasticloadbalancing:eu-west-1:111122223333:loadbalancer/app/api/50dc6c495c0c9188';
const tgArn = 'arn:aws:elasticloadbalancing:eu-west-1:111122223333:targetgroup/web/73e2d6bc24d8a067';
let deps: { cache: ReturnType<typeof createTtlCache>; log: Mock };

beforeEach(() => {
  elb.reset();
  deps = { cache: createTtlCache(), log: vi.fn() };
});

describe('dimensions', () => {
  it('derives CloudWatch dimensions from ARNs', () => {
    expect(loadBalancerDimension(lbArn)).toBe('app/api/50dc6c495c0c9188');
    expect(targetGroupDimension(tgArn)).toBe('targetgroup/web/73e2d6bc24d8a067');
  });
});

describe('describeTargetGroups', () => {
  it('describes in batches of 20 and maps the groups', async () => {
    const arns = Array.from({ length: 25 }, (_, i) => `arn:aws:elasticloadbalancing:eu-west-1:111122223333:targetgroup/tg-${String(i).padStart(2, '0')}/1`);
    elb.on(DescribeTargetGroupsCommand).callsFake((input: { TargetGroupArns?: string[] }) => ({
      TargetGroups: (input.TargetGroupArns ?? []).map((TargetGroupArn) => ({
        TargetGroupName: TargetGroupArn.split('/')[1],
        TargetGroupArn,
        Protocol: 'HTTP',
        Port: 80,
        TargetType: 'ip',
        HealthCheckPath: '/health',
        LoadBalancerArns: [lbArn],
      })),
    }));
    const result = await describeTargetGroups(target, [...arns].reverse(), deps);
    expect(elb.commandCalls(DescribeTargetGroupsCommand).map((c) => c.args[0].input.TargetGroupArns?.length)).toEqual([DESCRIBE_TARGET_GROUPS_BATCH, 5]);
    expect(result.ok && result.data.map((g) => g.name)).toEqual(arns.map((a) => a.split('/')[1]));
    expect(result.ok && result.data[0]).toEqual({ name: 'tg-00', arn: arns[0], protocol: 'HTTP', port: 80, targetType: 'ip', healthCheckPath: '/health', loadBalancerArns: [lbArn] });
  });

  it('makes no call without ARNs and treats a missing group as empty', async () => {
    expect(await describeTargetGroups(target, [], deps)).toEqual({ ok: true, data: [] });
    expect(elb.commandCalls(DescribeTargetGroupsCommand)).toHaveLength(0);

    elb.on(DescribeTargetGroupsCommand).rejects(Object.assign(new Error('no'), { name: 'TargetGroupNotFoundException' }));
    expect(await describeTargetGroups(target, [tgArn], deps)).toEqual({ ok: true, data: [] });
  });
});

describe('targetHealth', () => {
  it('maps target health descriptions', async () => {
    elb.on(DescribeTargetHealthCommand).resolves({
      TargetHealthDescriptions: [
        {
          Target: { Id: '10.0.1.10', Port: 80 },
          TargetHealth: { State: 'unhealthy', Reason: 'Target.ResponseCodeMismatch', Description: 'Health checks failed with these codes: [502]' },
        },
      ],
    });
    const result = await targetHealth(target, tgArn, deps);
    expect(elb.commandCalls(DescribeTargetHealthCommand).map((c) => c.args[0].input)).toEqual([{ TargetGroupArn: tgArn }]);
    expect(result).toEqual({
      ok: true,
      data: [{ id: '10.0.1.10', port: 80, state: 'unhealthy', reason: 'Target.ResponseCodeMismatch', description: 'Health checks failed with these codes: [502]' }],
    });
  });
});

describe('target group queries', () => {
  const group: TargetGroup = { name: 'web', arn: tgArn, protocol: 'HTTP', port: 80, targetType: 'ip', healthCheckPath: '/health', loadBalancerArns: [lbArn] };
  const dimensions = { LoadBalancer: 'app/api/50dc6c495c0c9188', TargetGroup: 'targetgroup/web/73e2d6bc24d8a067' };

  it('builds the request, 5xx and host queries', () => {
    expect(targetGroupQueries(group, 'g0')).toEqual([
      { id: 'g0req', namespace: 'AWS/ApplicationELB', metricName: 'RequestCount', dimensions, stat: 'Sum' },
      { id: 'g0t5xx', namespace: 'AWS/ApplicationELB', metricName: 'HTTPCode_Target_5XX_Count', dimensions, stat: 'Sum' },
      { id: 'g0healthy', namespace: 'AWS/ApplicationELB', metricName: 'HealthyHostCount', dimensions, stat: 'Average' },
      { id: 'g0unhealthy', namespace: 'AWS/ApplicationELB', metricName: 'UnHealthyHostCount', dimensions, stat: 'Maximum' },
    ]);
    expect(targetGroupQueries({ ...group, loadBalancerArns: [] }, 'g0')).toEqual([]);
  });

  it('builds the p95 latency query only with a load balancer', () => {
    expect(targetGroupLatencyQuery(group, 'g0')).toEqual({ id: 'g0p95', namespace: 'AWS/ApplicationELB', metricName: 'TargetResponseTime', dimensions, stat: 'p95' });
    expect(targetGroupLatencyQuery({ ...group, loadBalancerArns: [] }, 'g0')).toBeNull();
  });
});
