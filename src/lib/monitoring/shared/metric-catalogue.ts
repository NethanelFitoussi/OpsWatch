/**
 * What a CloudWatch metric actually means, in operational language.
 *
 * An alarm's own name is whatever somebody — or some AWS service — typed. `ApplicationInsights/
 * ApplicationInsights-ContainerInsights-ECS_CLUSTER-ecs-gigs-prod/AWS/ECS/CPUReservation/ecs-gigs-prod/`
 * is a real alarm name from a real estate, and an operator should never have to decode one to find out
 * what is wrong. The namespace and the metric name, which every alarm carries, are enough to say it
 * properly — and that is what this file turns them into.
 *
 * **Deterministic, never generated.** Each family's words are written once, in the message catalogue, and
 * are the same every time. A model paraphrasing `CPUReservation` differently on each render would be
 * worse than the identifier it replaced: at least the identifier is stable.
 *
 * **It says what the metric measures, not what is wrong.** "A high CPU reservation means the CPU reserved
 * by ECS tasks is a large share of the capacity registered in the cluster" is a fact about the metric.
 * Why it is high is not in the alarm, and the investigation steps are phrased as things to check rather
 * than as causes.
 *
 * Pure: an alarm's metadata in, an identifier out. The prose lives in `Monitoring.metrics.families.*`.
 */

/** What kind of thing an alarm is about, which decides where OpsWatch can offer to take the reader. */
export const RESOURCE_KINDS = [
  'ecs-cluster',
  'ecs-service',
  'load-balancer',
  'target-group',
  'instance',
  'database',
  'cache',
  'function',
  'queue',
  'unknown',
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/** How a figure reads. `percent` is why "≥ 64" becomes "≥ 64%" rather than a bare number. */
export type MetricShape = 'percent' | 'count' | 'seconds' | 'milliseconds' | 'bytes' | 'plain';

export type MetricFamily = {
  /** The message key under `Monitoring.metrics.families`, and the id a test pins. */
  id: string;
  resource: ResourceKind;
  shape: MetricShape;
  /** How many "what to check" steps this family has, so the renderer asks for exactly those. */
  checks: number;
};

/**
 * Namespace and metric name → family.
 *
 * Keyed on both, because `CPUUtilization` means something different on an ECS service, an EC2 instance
 * and an RDS database — and telling somebody to "check which services increased their reservation" about
 * a database would be worse than saying nothing.
 */
const FAMILIES: Record<string, MetricFamily> = {
  'AWS/ECS|CPUReservation': { id: 'ecsCpuReservation', resource: 'ecs-cluster', shape: 'percent', checks: 5 },
  'AWS/ECS|MemoryReservation': { id: 'ecsMemoryReservation', resource: 'ecs-cluster', shape: 'percent', checks: 5 },
  'AWS/ECS|CPUUtilization': { id: 'ecsCpuUtilization', resource: 'ecs-service', shape: 'percent', checks: 4 },
  'AWS/ECS|MemoryUtilization': { id: 'ecsMemoryUtilization', resource: 'ecs-service', shape: 'percent', checks: 4 },
  'ECS/ContainerInsights|RunningTaskCount': { id: 'ecsRunningTasks', resource: 'ecs-service', shape: 'count', checks: 4 },

  'AWS/ApplicationELB|HTTPCode_Target_5XX_Count': { id: 'albTarget5xx', resource: 'target-group', shape: 'count', checks: 5 },
  'AWS/ApplicationELB|HTTPCode_Target_4XX_Count': { id: 'albTarget4xx', resource: 'target-group', shape: 'count', checks: 4 },
  'AWS/ApplicationELB|HTTPCode_ELB_5XX_Count': { id: 'albElb5xx', resource: 'load-balancer', shape: 'count', checks: 4 },
  'AWS/ApplicationELB|TargetResponseTime': { id: 'albResponseTime', resource: 'target-group', shape: 'seconds', checks: 5 },
  'AWS/ApplicationELB|UnHealthyHostCount': { id: 'albUnhealthyHosts', resource: 'target-group', shape: 'count', checks: 4 },
  'AWS/ApplicationELB|RequestCount': { id: 'albRequests', resource: 'load-balancer', shape: 'count', checks: 3 },

  'AWS/EC2|CPUUtilization': { id: 'ec2Cpu', resource: 'instance', shape: 'percent', checks: 4 },
  'AWS/EC2|StatusCheckFailed': { id: 'ec2StatusCheck', resource: 'instance', shape: 'count', checks: 4 },
  'AWS/EC2|StatusCheckFailed_Instance': { id: 'ec2StatusCheckInstance', resource: 'instance', shape: 'count', checks: 4 },
  'AWS/EC2|StatusCheckFailed_System': { id: 'ec2StatusCheckSystem', resource: 'instance', shape: 'count', checks: 3 },

  'AWS/RDS|CPUUtilization': { id: 'rdsCpu', resource: 'database', shape: 'percent', checks: 5 },
  'AWS/RDS|FreeableMemory': { id: 'rdsFreeableMemory', resource: 'database', shape: 'bytes', checks: 4 },
  'AWS/RDS|FreeStorageSpace': { id: 'rdsFreeStorage', resource: 'database', shape: 'bytes', checks: 4 },
  'AWS/RDS|DatabaseConnections': { id: 'rdsConnections', resource: 'database', shape: 'count', checks: 4 },
  'AWS/RDS|ReadLatency': { id: 'rdsReadLatency', resource: 'database', shape: 'seconds', checks: 4 },
  'AWS/RDS|WriteLatency': { id: 'rdsWriteLatency', resource: 'database', shape: 'seconds', checks: 4 },
  'AWS/RDS|AuroraReplicaLag': { id: 'rdsReplicaLag', resource: 'database', shape: 'milliseconds', checks: 4 },

  'AWS/ElastiCache|EngineCPUUtilization': { id: 'redisEngineCpu', resource: 'cache', shape: 'percent', checks: 4 },
  'AWS/ElastiCache|CPUUtilization': { id: 'redisCpu', resource: 'cache', shape: 'percent', checks: 3 },
  'AWS/ElastiCache|DatabaseMemoryUsagePercentage': { id: 'redisMemory', resource: 'cache', shape: 'percent', checks: 4 },
  'AWS/ElastiCache|Evictions': { id: 'redisEvictions', resource: 'cache', shape: 'count', checks: 4 },
  'AWS/ElastiCache|CurrConnections': { id: 'redisConnections', resource: 'cache', shape: 'count', checks: 3 },

  'AWS/Lambda|Errors': { id: 'lambdaErrors', resource: 'function', shape: 'count', checks: 4 },
  'AWS/Lambda|Throttles': { id: 'lambdaThrottles', resource: 'function', shape: 'count', checks: 3 },
  'AWS/Lambda|Duration': { id: 'lambdaDuration', resource: 'function', shape: 'milliseconds', checks: 4 },

  'AWS/SQS|ApproximateAgeOfOldestMessage': { id: 'sqsAge', resource: 'queue', shape: 'seconds', checks: 4 },
  'AWS/SQS|ApproximateNumberOfMessagesVisible': { id: 'sqsDepth', resource: 'queue', shape: 'count', checks: 4 },
};

/**
 * The family an alarm belongs to, or null.
 *
 * Null is a real answer and the page has a shape for it: a custom metric OpsWatch has never heard of gets
 * its AWS name, its condition and its evidence — everything that is true — and no invented explanation.
 */
export function familyOf(alarm: { namespace: string | null; metricName: string | null }): MetricFamily | null {
  if (alarm.namespace === null || alarm.metricName === null) return null;
  return FAMILIES[`${alarm.namespace}|${alarm.metricName}`] ?? null;
}

/** Every family, for the test that holds the catalogue against its own messages. */
export const METRIC_FAMILIES: readonly MetricFamily[] = Object.values(FAMILIES);

/**
 * Which dimension names the resource, per kind.
 *
 * Ordered by how specific it is: an ECS service alarm carries both `ClusterName` and `ServiceName`, and
 * the service is what the reader is looking for.
 */
const KIND_DIMENSIONS: Record<ResourceKind, readonly string[]> = {
  'ecs-service': ['ServiceName'],
  'ecs-cluster': ['ClusterName'],
  'target-group': ['TargetGroup', 'LoadBalancer'],
  'load-balancer': ['LoadBalancer'],
  instance: ['InstanceId', 'AutoScalingGroupName'],
  database: ['DBInstanceIdentifier', 'DBClusterIdentifier'],
  cache: ['CacheClusterId', 'CacheClusterId'],
  function: ['FunctionName'],
  queue: ['QueueName'],
  unknown: [],
};

/**
 * Dimensions worth naming when the catalogue has no opinion about the metric.
 *
 * Ordered by how specific they are, so a custom alarm still says which thing it is about rather than
 * falling back to whichever dimension happened to come first.
 */
export const RESOURCE_DIMENSIONS = [
  'ServiceName',
  'DBInstanceIdentifier',
  'DBClusterIdentifier',
  'CacheClusterId',
  'InstanceId',
  'FunctionName',
  'QueueName',
  'TargetGroup',
  'LoadBalancer',
  'ClusterName',
  'AutoScalingGroupName',
] as const;

/**
 * What the alarm is about, as a kind and a name.
 *
 * The kind comes from the family, so a reader is told "ECS cluster" rather than left to infer it from a
 * dimension name. Where no family matches, the dimension that names something recognisable is still
 * offered — with `unknown` as the kind, because guessing would be the thing this file exists to stop.
 */
export function subjectOf(
  alarm: { namespace: string | null; metricName: string | null; dimensions: Record<string, string> },
  fallback: readonly string[],
): { kind: ResourceKind; name: string } | null {
  const family = familyOf(alarm);
  const names = family === null ? fallback : [...KIND_DIMENSIONS[family.resource], ...fallback];
  for (const dimension of names) {
    const value = alarm.dimensions[dimension];
    if (value !== undefined && value.length > 0) return { kind: family?.resource ?? 'unknown', name: value };
  }
  const [first] = Object.entries(alarm.dimensions);
  return first === undefined ? null : { kind: family?.resource ?? 'unknown', name: first[1] };
}
