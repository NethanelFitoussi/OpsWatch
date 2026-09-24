import { CloudWatchClient, PutMetricAlarmCommand, PutMetricDataCommand, SetAlarmStateCommand, type Dimension } from '@aws-sdk/client-cloudwatch';
import { CloudWatchLogsClient, CreateLogGroupCommand, CreateLogStreamCommand, PutLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { CreateSubnetCommand, CreateVpcCommand, EC2Client, RunInstancesCommand } from '@aws-sdk/client-ec2';
import { CreateClusterCommand, CreateServiceCommand, ECSClient, RegisterTaskDefinitionCommand } from '@aws-sdk/client-ecs';
import {
  CreateListenerCommand,
  CreateLoadBalancerCommand,
  CreateTargetGroupCommand,
  ElasticLoadBalancingV2Client,
  RegisterTargetsCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { CreateDBInstanceCommand, RDSClient } from '@aws-sdk/client-rds';

export const SEED = {
  region: 'us-east-1',
  cluster: 'opswatch-e2e',
  service: 'web',
  idleService: 'web-idle',
  taskFamily: 'opswatch-web',
  logGroup: '/ecs/opswatch-web',
  /** A second group under another prefix, so a picker search can show one without the other. */
  otherLogGroup: '/aws/lambda/opswatch-e2e-worker',
  logStream: 'web/web/e2e',
  logMessages: ['GET /health 200 3ms', 'GET /api/orders 500 1520ms', 'ERROR payment gateway timeout'],
  loadBalancer: 'opswatch-e2e-alb',
  targetGroup: 'opswatch-e2e-web',
  targetIp: '10.0.1.10',
  instancePrefix: 'opswatch-e2e-host',
  redisCluster: 'opswatch-e2e-cache',
  kubeCluster: 'opswatch-e2e-eks',
  kubeWorkload: 'checkout',
  dbInstance: 'opswatch-e2e-db',
  alarm: 'opswatch-e2e-high-cpu',
  targetTrackingAlarm: 'TargetTracking-service/opswatch-e2e/web-AlarmHigh-e2e',
  okAlarm: 'opswatch-e2e-db-connections',
  unknownAlarm: 'opswatch-e2e-cache-engine-cpu',
  longAlarm: 'opswatch-e2e-payments-business-transactions-failed-across-all-regions-critical',
  /** One datapoint per minute for the 30 whole minutes before the seed ran. */
  datapoints: 30,
} as const;

export type SeedResult = {
  vpcId: string;
  loadBalancerArn: string;
  targetGroupArn: string;
  loadBalancerDimension: string;
  targetGroupDimension: string;
};

export function motoClientConfig(endpoint: string) {
  return { region: SEED.region, endpoint, credentials: { accessKeyId: 'testing', secretAccessKey: 'testing' } };
}

export async function waitForMoto(endpoint: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${endpoint}/moto-api/`);
      if (res.ok) return;
    } catch {
      // moto is still starting
    }
    if (Date.now() > deadline) throw new Error(`moto did not answer at ${endpoint} within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function resetMoto(endpoint: string): Promise<void> {
  const res = await fetch(`${endpoint}/moto-api/reset`, { method: 'POST' });
  if (!res.ok) throw new Error(`moto reset failed with HTTP ${res.status}`);
}

/** moto matches dimensions in order (fact 4): always send them sorted by name, as metrics.ts does. */
function dimensions(values: Record<string, string>): Dimension[] {
  return Object.entries(values)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([Name, Value]) => ({ Name, Value }));
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`moto returned no ${what}`);
  return value;
}

export async function seedMoto(endpoint: string, now: Date = new Date()): Promise<SeedResult> {
  const config = motoClientConfig(endpoint);
  const ec2 = new EC2Client(config);
  const elb = new ElasticLoadBalancingV2Client(config);
  const ecs = new ECSClient(config);
  const rds = new RDSClient(config);
  const cw = new CloudWatchClient(config);
  const logs = new CloudWatchLogsClient(config);

  // Network (fact 5): an ALB needs two subnets in different zones.
  const vpcId = required((await ec2.send(new CreateVpcCommand({ CidrBlock: '10.0.0.0/16' }))).Vpc?.VpcId, 'VPC id');
  const subnets = await Promise.all(
    [['10.0.1.0/24', 'us-east-1a'], ['10.0.2.0/24', 'us-east-1b']].map(async ([CidrBlock, AvailabilityZone]) =>
      required((await ec2.send(new CreateSubnetCommand({ VpcId: vpcId, CidrBlock, AvailabilityZone }))).Subnet?.SubnetId, 'subnet id'),
    ),
  );

  // EC2 (fact 5 again): two zones, so the host map has something to group by. moto publishes no
  // CloudWatch status checks for them, which is the point — a running instance nobody can vouch for is
  // `unknown`, and the acceptance walk proves that missing telemetry never becomes green.
  await Promise.all(
    subnets.map((SubnetId, index) =>
      ec2.send(
        new RunInstancesCommand({
          ImageId: 'ami-12345678',
          InstanceType: index === 0 ? 't3.small' : 't3.micro',
          MinCount: 1,
          MaxCount: 1,
          SubnetId,
          TagSpecifications: [{ ResourceType: 'instance', Tags: [{ Key: 'Name', Value: `${SEED.instancePrefix}-${index === 0 ? 'a' : 'b'}` }] }],
        }),
      ),
    ),
  );

  const loadBalancerArn = required(
    (await elb.send(new CreateLoadBalancerCommand({ Name: SEED.loadBalancer, Type: 'application', Subnets: subnets }))).LoadBalancers?.[0]?.LoadBalancerArn,
    'load balancer ARN',
  );
  const targetGroupArn = required(
    (await elb.send(new CreateTargetGroupCommand({ Name: SEED.targetGroup, Protocol: 'HTTP', Port: 80, VpcId: vpcId, TargetType: 'ip' }))).TargetGroups?.[0]?.TargetGroupArn,
    'target group ARN',
  );
  await elb.send(new CreateListenerCommand({ LoadBalancerArn: loadBalancerArn, Protocol: 'HTTP', Port: 80, DefaultActions: [{ Type: 'forward', TargetGroupArn: targetGroupArn }] }));
  await elb.send(new RegisterTargetsCommand({ TargetGroupArn: targetGroupArn, Targets: [{ Id: SEED.targetIp, Port: 80 }] }));
  const loadBalancerDimension = loadBalancerArn.split(':loadbalancer/')[1];
  const targetGroupDimension = targetGroupArn.slice(targetGroupArn.lastIndexOf(':') + 1);

  // ECS (fact 6): tasks never start, so runningCount stays 0 and the deployment stays IN_PROGRESS.
  await ecs.send(new CreateClusterCommand({ clusterName: SEED.cluster, settings: [{ name: 'containerInsights', value: 'enabled' }] }));
  await ecs.send(
    new RegisterTaskDefinitionCommand({
      family: SEED.taskFamily,
      containerDefinitions: [
        {
          name: 'web',
          image: 'nginx',
          memory: 256,
          portMappings: [{ containerPort: 80 }],
          logConfiguration: { logDriver: 'awslogs', options: { 'awslogs-group': SEED.logGroup, 'awslogs-region': SEED.region, 'awslogs-stream-prefix': 'web' } },
        },
      ],
    }),
  );
  await ecs.send(
    new CreateServiceCommand({
      cluster: SEED.cluster,
      serviceName: SEED.service,
      taskDefinition: SEED.taskFamily,
      desiredCount: 2,
      loadBalancers: [{ targetGroupArn, containerName: 'web', containerPort: 80 }],
    }),
  );
  // A second service, deliberately parked at zero tasks. It is the estate's one genuinely *healthy*
  // resource, which is what lets the acceptance walk prove that green is reachable and earned — a
  // fixture where everything is broken can only ever test the unhappy half of the product.
  await ecs.send(
    new CreateServiceCommand({
      cluster: SEED.cluster,
      serviceName: SEED.idleService,
      taskDefinition: SEED.taskFamily,
      desiredCount: 0,
    }),
  );

  // RDS (fact 7): Performance Insights is never reported as enabled.
  await rds.send(
    new CreateDBInstanceCommand({
      DBInstanceIdentifier: SEED.dbInstance,
      DBInstanceClass: 'db.t3.medium',
      Engine: 'mysql',
      AllocatedStorage: 20,
      MasterUsername: 'admin',
      MasterUserPassword: 'not-a-real-password-1',
    }),
  );

  // Metrics: whole minutes strictly before the minute of `now`, so every datapoint is inside any window ending at the current minute.
  const base = Math.floor(now.getTime() / 60_000) * 60_000;
  const put = (Namespace: string, MetricName: string, dims: Record<string, string>, value: (i: number) => number, Unit?: 'Percent' | 'Count' | 'Bytes' | 'Seconds' | 'Count/Second') =>
    cw.send(
      new PutMetricDataCommand({
        Namespace,
        MetricData: Array.from({ length: SEED.datapoints }, (_, i) => ({
          MetricName,
          Dimensions: dimensions(dims),
          Timestamp: new Date(base - (i + 1) * 60_000),
          Value: value(i),
          ...(Unit ? { Unit } : {}),
        })),
      }),
    );
  const service = { ClusterName: SEED.cluster, ServiceName: SEED.service };
  const db = { DBInstanceIdentifier: SEED.dbInstance };
  const lb = { LoadBalancer: loadBalancerDimension };
  const tg = { LoadBalancer: loadBalancerDimension, TargetGroup: targetGroupDimension };
  await Promise.all([
    put('AWS/ECS', 'CPUUtilization', service, (i) => 35 + (i % 5), 'Percent'),
    put('AWS/ECS', 'MemoryUtilization', service, (i) => 55 + (i % 3), 'Percent'),
    put('ECS/ContainerInsights', 'RunningTaskCount', service, () => 2, 'Count'),
    put('ECS/ContainerInsights', 'DesiredTaskCount', service, () => 2, 'Count'),
    put('AWS/RDS', 'CPUUtilization', db, (i) => 20 + (i % 4), 'Percent'),
    put('AWS/RDS', 'DatabaseConnections', db, () => 12, 'Count'),
    put('AWS/RDS', 'FreeableMemory', db, () => 3 * 1024 ** 3, 'Bytes'),
    put('AWS/RDS', 'ReadIOPS', db, () => 40, 'Count/Second'),
    put('AWS/RDS', 'WriteIOPS', db, () => 25, 'Count/Second'),
    put('AWS/RDS', 'ReadLatency', db, () => 0.002, 'Seconds'),
    put('AWS/RDS', 'WriteLatency', db, () => 0.004, 'Seconds'),
    put('AWS/ApplicationELB', 'RequestCount', lb, () => 120, 'Count'),
    put('AWS/ApplicationELB', 'HTTPCode_Target_5XX_Count', lb, () => 1, 'Count'),
    put('AWS/ApplicationELB', 'TargetResponseTime', lb, () => 0.12, 'Seconds'),
    put('AWS/ApplicationELB', 'RequestCount', tg, () => 120, 'Count'),
    put('AWS/ApplicationELB', 'HTTPCode_Target_5XX_Count', tg, () => 1, 'Count'),
    put('AWS/ApplicationELB', 'TargetResponseTime', tg, () => 0.12, 'Seconds'),
    put('AWS/ApplicationELB', 'HealthyHostCount', tg, () => 1, 'Count'),
    put('AWS/ApplicationELB', 'UnHealthyHostCount', tg, () => 0, 'Count'),
    // ElastiCache: one cluster, two nodes, discovered the way the product discovers them — through the
    // engine CPU metric. `0001` is comfortable and `0002` is over AWS's warning threshold, so one page
    // carries a green node and an amber one and the acceptance walk can tell them apart.
    // Container Insights: the only way OpsWatch can see Kubernetes, so the fixture publishes exactly the
    // dimension sets a real EKS cluster does — cluster, node, namespace, workload, pod. One pod has
    // restarted, so the acceptance walk has a green pod and an amber one to tell apart.
    put('ContainerInsights', 'cluster_node_count', { ClusterName: SEED.kubeCluster }, () => 2, 'Count'),
    put('ContainerInsights', 'cluster_failed_node_count', { ClusterName: SEED.kubeCluster }, () => 0, 'Count'),
    ...['ip-10-0-1-11', 'ip-10-0-2-12'].flatMap((NodeName, node) => {
      const dims = { ClusterName: SEED.kubeCluster, NodeName };
      return [
        put('ContainerInsights', 'node_cpu_utilization', dims, (i) => (node === 0 ? 31 : 18) + (i % 3), 'Percent'),
        put('ContainerInsights', 'node_memory_utilization', dims, () => (node === 0 ? 47 : 39), 'Percent'),
        put('ContainerInsights', 'node_number_of_running_pods', dims, () => (node === 0 ? 2 : 1), 'Count'),
      ];
    }),
    put('ContainerInsights', 'namespace_number_of_running_pods', { ClusterName: SEED.kubeCluster, Namespace: 'default' }, () => 3, 'Count'),
    put('ContainerInsights', 'service_number_of_running_pods', { ClusterName: SEED.kubeCluster, Namespace: 'default', Service: SEED.kubeWorkload }, () => 3, 'Count'),
    ...[
      { PodName: 'checkout-7d9f-aaa', cpu: 22, restarts: 0 },
      { PodName: 'checkout-7d9f-bbb', cpu: 27, restarts: 0 },
      { PodName: 'checkout-7d9f-ccc', cpu: 24, restarts: 3 },
    ].flatMap(({ PodName, cpu, restarts }) => {
      const dims = { ClusterName: SEED.kubeCluster, Namespace: 'default', PodName };
      return [
        put('ContainerInsights', 'pod_cpu_utilization', dims, (i) => cpu + (i % 2), 'Percent'),
        put('ContainerInsights', 'pod_memory_utilization', dims, () => 41, 'Percent'),
        put('ContainerInsights', 'pod_number_of_container_restarts', dims, () => restarts, 'Count'),
      ];
    }),
    ...['0001', '0002'].flatMap((CacheNodeId, node) => {
      const dims = { CacheClusterId: SEED.redisCluster, CacheNodeId };
      const hot = node === 1;
      return [
        put('AWS/ElastiCache', 'EngineCPUUtilization', dims, (i) => (hot ? 82 : 21) + (i % 3), 'Percent'),
        put('AWS/ElastiCache', 'CPUUtilization', dims, (i) => (hot ? 28 : 8) + (i % 2), 'Percent'),
        put('AWS/ElastiCache', 'DatabaseMemoryUsagePercentage', dims, () => (hot ? 62 : 31), 'Percent'),
        put('AWS/ElastiCache', 'CurrConnections', dims, () => (hot ? 240 : 30), 'Count'),
        put('AWS/ElastiCache', 'Evictions', dims, () => 0, 'Count'),
        put('AWS/ElastiCache', 'CacheHits', dims, () => (hot ? 900 : 400), 'Count'),
        put('AWS/ElastiCache', 'CacheMisses', dims, () => (hot ? 100 : 100), 'Count'),
      ];
    }),
  ]);

  // Alarms (fact 9).
  const alarm = (AlarmName: string, Namespace: string, MetricName: string, dims: Record<string, string>, Threshold: number) =>
    cw.send(
      new PutMetricAlarmCommand({
        AlarmName,
        Namespace,
        MetricName,
        Dimensions: dimensions(dims),
        Statistic: 'Average',
        Period: 60,
        EvaluationPeriods: 3,
        Threshold,
        ComparisonOperator: 'GreaterThanThreshold',
      }),
    );
  await alarm(SEED.alarm, 'AWS/ECS', 'CPUUtilization', service, 30);
  await alarm(SEED.targetTrackingAlarm, 'AWS/ECS', 'CPUUtilization', service, 70);
  await alarm(SEED.okAlarm, 'AWS/RDS', 'DatabaseConnections', db, 500);
  await cw.send(new SetAlarmStateCommand({ AlarmName: SEED.alarm, StateValue: 'ALARM', StateReason: 'Seeded for end-to-end tests' }));
  await cw.send(new SetAlarmStateCommand({ AlarmName: SEED.targetTrackingAlarm, StateValue: 'ALARM', StateReason: 'Seeded for end-to-end tests' }));
  await cw.send(new SetAlarmStateCommand({ AlarmName: SEED.okAlarm, StateValue: 'OK', StateReason: 'Seeded for end-to-end tests' }));

  // The third alarm state, which is the one a dashboard is most tempted to fold into OK. Left at its
  // default so AWS reports INSUFFICIENT_DATA rather than a state somebody set.
  await alarm(SEED.unknownAlarm, 'AWS/ElastiCache', 'EngineCPUUtilization', { CacheClusterId: SEED.redisCluster }, 90);
  // moto starts an alarm at OK; AWS leaves one INSUFFICIENT_DATA until a datapoint arrives, and it is
  // that state the product must never fold into OK.
  await cw.send(
    new SetAlarmStateCommand({
      AlarmName: SEED.unknownAlarm,
      StateValue: 'INSUFFICIENT_DATA',
      StateReason: 'Insufficient Data: 3 datapoints were unknown.',
    }),
  );
  // An alarm with no dimension AWS recognises as a resource, and a name long enough to break a layout.
  await cw.send(
    new PutMetricAlarmCommand({
      AlarmName: SEED.longAlarm,
      Namespace: 'Acme/Custom',
      MetricName: 'BusinessTransactionsFailedPerMinuteAcrossAllRegions',
      Statistic: 'Sum',
      Period: 300,
      EvaluationPeriods: 2,
      DatapointsToAlarm: 2,
      Threshold: 5,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      AlarmDescription: 'Raised by the payments team when more than five business transactions fail in ten minutes.',
      TreatMissingData: 'notBreaching',
    }),
  );
  await cw.send(
    new SetAlarmStateCommand({
      AlarmName: SEED.longAlarm,
      StateValue: 'ALARM',
      // The shape CloudWatch actually writes, so the parser is exercised against the real sentence.
      StateReason: 'Threshold Crossed: 2 datapoints [83.0 (24/09/25 12:00:00), 91.5 (24/09/25 12:05:00)] were greater than or equal to the threshold (5.0).',
    }),
  );

  // Logs (fact 10): events within the last few minutes, oldest first.
  await logs.send(new CreateLogGroupCommand({ logGroupName: SEED.logGroup }));
  await logs.send(new CreateLogGroupCommand({ logGroupName: SEED.otherLogGroup }));
  await logs.send(new CreateLogStreamCommand({ logGroupName: SEED.logGroup, logStreamName: SEED.logStream }));
  await logs.send(
    new PutLogEventsCommand({
      logGroupName: SEED.logGroup,
      logStreamName: SEED.logStream,
      logEvents: SEED.logMessages.map((message, i) => ({ message, timestamp: now.getTime() - (SEED.logMessages.length - i) * 60_000 })),
    }),
  );

  return { vpcId, loadBalancerArn, targetGroupArn, loadBalancerDimension, targetGroupDimension };
}
