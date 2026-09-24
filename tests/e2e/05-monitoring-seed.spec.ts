import { CloudWatchClient, DescribeAlarmsCommand, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { CloudWatchLogsClient, GetQueryResultsCommand, StartQueryCommand } from '@aws-sdk/client-cloudwatch-logs';
import { DescribeServicesCommand, DescribeTaskDefinitionCommand, ECSClient } from '@aws-sdk/client-ecs';
import { DescribeLoadBalancersCommand, DescribeTargetHealthCommand, ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';
import { DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import { expect, test } from '@playwright/test';
import { MOTO_URL } from './helpers';
import { SEED, motoClientConfig } from './seed/moto-seed';

const config = motoClientConfig(MOTO_URL);
const minute = (ms: number) => Math.floor(ms / 60_000) * 60_000;

test('the seeded ECS service uses the target group and an awslogs log group', async () => {
  const ecs = new ECSClient(config);
  const { services } = await ecs.send(new DescribeServicesCommand({ cluster: SEED.cluster, services: [SEED.service] }));
  expect(services?.[0]?.desiredCount).toBe(2);
  expect(services?.[0]?.loadBalancers?.[0]?.targetGroupArn).toContain(`targetgroup/${SEED.targetGroup}/`);
  const { taskDefinition } = await ecs.send(new DescribeTaskDefinitionCommand({ taskDefinition: SEED.taskFamily }));
  expect(taskDefinition?.containerDefinitions?.[0]?.logConfiguration?.options?.['awslogs-group']).toBe(SEED.logGroup);
  const elb = new ElasticLoadBalancingV2Client(config);
  const health = await elb.send(new DescribeTargetHealthCommand({ TargetGroupArn: services?.[0]?.loadBalancers?.[0]?.targetGroupArn }));
  expect(health.TargetHealthDescriptions?.map((d) => [d.Target?.Id, d.TargetHealth?.State])).toEqual([[SEED.targetIp, 'healthy']]);
});

test('the seeded database instance exists', async () => {
  const rds = new RDSClient(config);
  const { DBInstances } = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: SEED.dbInstance }));
  expect(DBInstances?.[0]).toMatchObject({ Engine: 'mysql', DBInstanceClass: 'db.t3.medium' });
});

test('GetMetricData returns the seeded datapoints for dimensions sorted by name', async () => {
  const { LoadBalancers } = await new ElasticLoadBalancingV2Client(config).send(new DescribeLoadBalancersCommand({ Names: [SEED.loadBalancer] }));
  const loadBalancer = LoadBalancers?.[0]?.LoadBalancerArn?.split(':loadbalancer/')[1] ?? '';
  const cw = new CloudWatchClient(config);
  const end = new Date(minute(Date.now()));
  const out = await cw.send(
    new GetMetricDataCommand({
      StartTime: new Date(end.getTime() - 3 * 3600_000),
      EndTime: end,
      MetricDataQueries: [
        {
          Id: 'cpu',
          ReturnData: true,
          MetricStat: {
            Metric: {
              Namespace: 'AWS/ECS',
              MetricName: 'CPUUtilization',
              Dimensions: [{ Name: 'ClusterName', Value: SEED.cluster }, { Name: 'ServiceName', Value: SEED.service }],
            },
            Period: 60,
            Stat: 'Average',
          },
        },
        {
          Id: 'req',
          ReturnData: true,
          MetricStat: {
            Metric: { Namespace: 'AWS/ApplicationELB', MetricName: 'RequestCount', Dimensions: [{ Name: 'LoadBalancer', Value: loadBalancer }] },
            Period: 60,
            Stat: 'Sum',
          },
        },
      ],
    }),
  );
  const cpu = out.MetricDataResults?.find((r) => r.Id === 'cpu');
  expect(cpu?.Values).toHaveLength(SEED.datapoints);
  expect(Math.min(...(cpu?.Values ?? []))).toBeGreaterThanOrEqual(35);
  expect(Math.max(...(cpu?.Values ?? []))).toBeLessThanOrEqual(39);
  const requests = out.MetricDataResults?.find((r) => r.Id === 'req')?.Values ?? [];
  expect(requests.reduce((a, b) => a + b, 0)).toBe(SEED.datapoints * 120);
});

// Known moto 5.2.3 gap (fact 2): the whole request fails, so p95 values are only unit-tested.
test('moto rejects percentile statistics', async () => {
  const cw = new CloudWatchClient(config);
  const end = new Date(minute(Date.now()));
  await expect(
    cw.send(
      new GetMetricDataCommand({
        StartTime: new Date(end.getTime() - 3600_000),
        EndTime: end,
        MetricDataQueries: [
          {
            Id: 'p95',
            ReturnData: true,
            MetricStat: {
              Metric: { Namespace: 'AWS/ECS', MetricName: 'CPUUtilization', Dimensions: [{ Name: 'ClusterName', Value: SEED.cluster }, { Name: 'ServiceName', Value: SEED.service }] },
              Period: 60,
              Stat: 'p95',
            },
          },
        ],
      }),
    ),
  ).rejects.toThrow();
});

test('the seeded alarms and log events are readable', async () => {
  const cw = new CloudWatchClient(config);
  const { MetricAlarms } = await cw.send(new DescribeAlarmsCommand({ AlarmTypes: ['MetricAlarm', 'CompositeAlarm'] }));
  const states = Object.fromEntries((MetricAlarms ?? []).map((a) => [a.AlarmName, a.StateValue]));
  expect(states).toEqual({
    [SEED.alarm]: 'ALARM',
    [SEED.targetTrackingAlarm]: 'ALARM',
    [SEED.okAlarm]: 'OK',
    // All three CloudWatch states are seeded, because a page that folds the third into OK passes every
    // test written against the first two.
    [SEED.unknownAlarm]: 'INSUFFICIENT_DATA',
    [SEED.longAlarm]: 'ALARM',
  });

  const logs = new CloudWatchLogsClient(config);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const { queryId } = await logs.send(
    new StartQueryCommand({ logGroupNames: [SEED.logGroup], startTime: nowSeconds - 3600, endTime: nowSeconds + 60, queryString: 'fields @timestamp, @message | sort @timestamp desc | limit 100' }),
  );
  const results = await logs.send(new GetQueryResultsCommand({ queryId }));
  expect(results.status).toBe('Complete');
  expect(results.results).toHaveLength(SEED.logMessages.length);
});
