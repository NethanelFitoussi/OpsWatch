import {
  DescribeLoadBalancersCommand,
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
  ElasticLoadBalancingV2Client,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createTtlCache } from '@/lib/monitoring/cache';
import {
  DESCRIBE_TARGET_GROUPS_BATCH,
  describeTargetGroups,
  findLoadBalancer,
  listLoadBalancers,
  listTargetGroups,
  loadBalancerDimension,
  loadBalancerLatencyQuery,
  loadBalancerQueries,
  targetGroupDimension,
  targetGroupLatencyQuery,
  targetGroupQueries,
  targetHealth,
  targetHealthCounts,
  type LoadBalancer,
  type TargetGroup,
  type TargetHealthEntry,
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

describe('listLoadBalancers', () => {
  it('paginates, keeps application load balancers only, and sorts by name', async () => {
    elb
      .on(DescribeLoadBalancersCommand)
      .resolvesOnce({
        LoadBalancers: [
          {
            LoadBalancerName: 'api',
            LoadBalancerArn: lbArn,
            DNSName: 'api-1.eu-west-1.elb.amazonaws.com',
            Scheme: 'internet-facing',
            State: { Code: 'active' },
            VpcId: 'vpc-1',
            CreatedTime: new Date('2026-01-01T00:00:00Z'),
            Type: 'application',
          },
        ],
        NextMarker: 'm',
      })
      .resolvesOnce({
        LoadBalancers: [
          { LoadBalancerName: 'internal-net', LoadBalancerArn: 'arn:aws:elasticloadbalancing:eu-west-1:111122223333:loadbalancer/net/internal-net/1', Type: 'network' },
        ],
      });
    const result = await listLoadBalancers(target, deps);
    expect(elb.commandCalls(DescribeLoadBalancersCommand).map((c) => c.args[0].input)).toEqual([{ PageSize: 400 }, { PageSize: 400, Marker: 'm' }]);
    expect(result).toEqual({
      ok: true,
      data: [
        {
          name: 'api',
          arn: lbArn,
          dimension: 'app/api/50dc6c495c0c9188',
          dnsName: 'api-1.eu-west-1.elb.amazonaws.com',
          scheme: 'internet-facing',
          state: 'active',
          vpcId: 'vpc-1',
          createdAt: Date.parse('2026-01-01T00:00:00Z'),
        },
      ],
    });
  });
});

describe('findLoadBalancer', () => {
  it('finds an application load balancer by name', async () => {
    elb.on(DescribeLoadBalancersCommand).resolves({
      LoadBalancers: [
        {
          LoadBalancerName: 'api',
          LoadBalancerArn: lbArn,
          DNSName: 'api-1.eu-west-1.elb.amazonaws.com',
          Scheme: 'internet-facing',
          State: { Code: 'active' },
          VpcId: 'vpc-1',
          CreatedTime: new Date('2026-01-01T00:00:00Z'),
          Type: 'application',
        },
      ],
    });
    const result = await findLoadBalancer(target, 'api', deps);
    expect(elb.commandCalls(DescribeLoadBalancersCommand).map((c) => c.args[0].input)).toEqual([{ Names: ['api'] }]);
    expect(result).toEqual({
      ok: true,
      data: {
        name: 'api',
        arn: lbArn,
        dimension: 'app/api/50dc6c495c0c9188',
        dnsName: 'api-1.eu-west-1.elb.amazonaws.com',
        scheme: 'internet-facing',
        state: 'active',
        vpcId: 'vpc-1',
        createdAt: Date.parse('2026-01-01T00:00:00Z'),
      },
    });
  });

  it('treats LoadBalancerNotFoundException as null', async () => {
    elb.on(DescribeLoadBalancersCommand).rejects(Object.assign(new Error('no'), { name: 'LoadBalancerNotFoundException' }));
    expect(await findLoadBalancer(target, 'missing', deps)).toEqual({ ok: true, data: null });
  });

  it('treats a non-application load balancer as null', async () => {
    elb.on(DescribeLoadBalancersCommand).resolves({ LoadBalancers: [{ LoadBalancerName: 'net', LoadBalancerArn: 'arn:x', Type: 'network' }] });
    expect(await findLoadBalancer(target, 'net', deps)).toEqual({ ok: true, data: null });
  });
});

describe('listTargetGroups', () => {
  it('filters by load balancer ARN and paginates', async () => {
    elb
      .on(DescribeTargetGroupsCommand)
      .resolvesOnce({
        TargetGroups: [{ TargetGroupName: 'web', TargetGroupArn: tgArn, Protocol: 'HTTP', Port: 80, TargetType: 'ip', HealthCheckPath: '/health', LoadBalancerArns: [lbArn] }],
        NextMarker: 'm',
      })
      .resolvesOnce({ TargetGroups: [] });
    const result = await listTargetGroups(target, lbArn, deps);
    expect(elb.commandCalls(DescribeTargetGroupsCommand).map((c) => c.args[0].input)).toEqual([
      { LoadBalancerArn: lbArn, PageSize: 400 },
      { LoadBalancerArn: lbArn, PageSize: 400, Marker: 'm' },
    ]);
    expect(result).toEqual({
      ok: true,
      data: [{ name: 'web', arn: tgArn, protocol: 'HTTP', port: 80, targetType: 'ip', healthCheckPath: '/health', loadBalancerArns: [lbArn] }],
    });
  });

  it('lists all target groups when no load balancer ARN is given', async () => {
    elb.on(DescribeTargetGroupsCommand).resolves({ TargetGroups: [] });
    await listTargetGroups(target, null, deps);
    expect(elb.commandCalls(DescribeTargetGroupsCommand).map((c) => c.args[0].input)).toEqual([{ PageSize: 400 }]);
  });
});

describe('load balancer queries', () => {
  const lb: LoadBalancer = {
    name: 'api',
    arn: lbArn,
    dimension: 'app/api/50dc6c495c0c9188',
    dnsName: null,
    scheme: null,
    state: null,
    vpcId: null,
    createdAt: null,
  };
  const dimensions = { LoadBalancer: 'app/api/50dc6c495c0c9188' };

  it('builds the request and 5xx queries', () => {
    expect(loadBalancerQueries(lb, 'l0')).toEqual([
      { id: 'l0req', namespace: 'AWS/ApplicationELB', metricName: 'RequestCount', dimensions, stat: 'Sum' },
      { id: 'l0elb5xx', namespace: 'AWS/ApplicationELB', metricName: 'HTTPCode_ELB_5XX_Count', dimensions, stat: 'Sum' },
      { id: 'l0t5xx', namespace: 'AWS/ApplicationELB', metricName: 'HTTPCode_Target_5XX_Count', dimensions, stat: 'Sum' },
    ]);
  });

  it('builds the p95 latency query', () => {
    expect(loadBalancerLatencyQuery(lb, 'l0')).toEqual({ id: 'l0p95', namespace: 'AWS/ApplicationELB', metricName: 'TargetResponseTime', dimensions, stat: 'p95' });
  });
});

describe('targetHealthCounts', () => {
  it('counts healthy and unhealthy targets only', () => {
    const entry = (state: string): TargetHealthEntry => ({ id: '10.0.0.1', port: 80, state, reason: null, description: null });
    const entries = [entry('healthy'), entry('unhealthy'), entry('draining'), entry('initial'), entry('unhealthy.draining')];
    expect(targetHealthCounts(entries)).toEqual({ healthy: 1, unhealthy: 1 });
  });
});
