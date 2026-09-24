/**
 * Making a CloudWatch alarm legible without inventing anything.
 *
 * An alarm row used to read `TargetTracking-service/opswatch-e2e/web-AlarmHigh-e2e` beside a truncated
 * sentence AWS wrote for a machine. Everything here is *derived from metadata the alarm already carries* —
 * its namespace, its dimensions, its condition — and everything that cannot be derived comes back `null`
 * so a page can say it does not know rather than guess.
 *
 * Pure: an alarm in, facts out. No clock, no database, no AWS.
 */

/** The services OpsWatch can recognise from a namespace. `other` is honest, not a dumping ground. */
export const ALARM_SERVICES = ['ecs', 'ec2', 'rds', 'redis', 'alb', 'lambda', 'sqs', 'dynamodb', 'other'] as const;
export type AlarmService = (typeof ALARM_SERVICES)[number];

/**
 * Namespace → service.
 *
 * AWS's own namespaces, not a guess from the alarm's name: a name is whatever somebody typed, and
 * classifying on it would put `prod-ecs-backup-rds-lag` in the wrong group with total confidence.
 */
const NAMESPACE_SERVICE: Record<string, AlarmService> = {
  'AWS/ECS': 'ecs',
  'ECS/ContainerInsights': 'ecs',
  'AWS/EC2': 'ec2',
  'AWS/RDS': 'rds',
  'AWS/ElastiCache': 'redis',
  'AWS/ApplicationELB': 'alb',
  'AWS/NetworkELB': 'alb',
  'AWS/ELB': 'alb',
  'AWS/Lambda': 'lambda',
  'AWS/SQS': 'sqs',
  'AWS/DynamoDB': 'dynamodb',
  ContainerInsights: 'ecs',
};

export function serviceOf(alarm: { namespace: string | null }): AlarmService {
  return alarm.namespace === null ? 'other' : (NAMESPACE_SERVICE[alarm.namespace] ?? 'other');
}

/**
 * Which dimension names a resource, per service.
 *
 * A dimension set can hold several; the one an operator recognises is the instance, the cluster, the
 * queue. Ordered, so the most specific wins where an alarm carries both.
 */
const RESOURCE_DIMENSIONS: readonly string[] = [
  'ServiceName',
  'DBInstanceIdentifier',
  'DBClusterIdentifier',
  'CacheClusterId',
  'InstanceId',
  'FunctionName',
  'QueueName',
  'TableName',
  'TargetGroup',
  'LoadBalancer',
  'ClusterName',
  'AutoScalingGroupName',
];

/** The resource an alarm watches, or null where its dimensions name none that OpsWatch recognises. */
export function resourceOf(alarm: { dimensions: Record<string, string> }): { dimension: string; value: string } | null {
  for (const name of RESOURCE_DIMENSIONS) {
    const value = alarm.dimensions[name];
    if (value !== undefined && value.length > 0) return { dimension: name, value };
  }
  const [first] = Object.entries(alarm.dimensions);
  return first === undefined ? null : { dimension: first[0], value: first[1] };
}

/** The comparison, as an operator writes it rather than as AWS names it. */
export const COMPARISONS: Record<string, string> = {
  GreaterThanThreshold: '>',
  GreaterThanOrEqualToThreshold: '≥',
  LessThanThreshold: '<',
  LessThanOrEqualToThreshold: '≤',
  LessThanLowerOrGreaterThanUpperThreshold: 'outside',
  GreaterThanUpperThreshold: '> upper',
  LessThanLowerThreshold: '< lower',
};

/**
 * The datapoint AWS quoted when it last changed the alarm's state.
 *
 * CloudWatch writes a sentence for a machine: `Threshold Crossed: 1 datapoint [83.0 (24/09/25 12:00:00)]
 * was greater than the threshold (80.0).` The number in the brackets is a real measurement AWS reported,
 * and pulling it out is the only way to show a value without paying for a second metric call.
 *
 * It is parsed conservatively and returns `null` the moment the sentence is not the shape expected —
 * because a number guessed out of prose is exactly the fabrication this product refuses. What is shown is
 * always "what AWS reported when it last changed", never "the current value".
 */
export function reportedValue(stateReason: string): number | null {
  // `[83.0 (24/09/25 12:00:00)]` or `[83.0 (…), 84.0 (…)]` — the first datapoint is the one quoted.
  const match = /\[\s*(-?\d+(?:\.\d+)?)\s*\(/.exec(stateReason);
  if (match === null) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Why AWS says the alarm is where it is, in one of three shapes it actually uses.
 *
 * `null` for anything else: the raw sentence is still available, and paraphrasing prose OpsWatch does not
 * recognise would be putting words in AWS's mouth.
 */
export type AlarmReason = 'crossed' | 'within' | 'no_data' | null;

export function reasonKind(stateReason: string): AlarmReason {
  if (/^Threshold Crossed/i.test(stateReason)) return 'crossed';
  if (/no longer breaching|within the threshold/i.test(stateReason)) return 'within';
  if (/Insufficient Data|no datapoints were received/i.test(stateReason)) return 'no_data';
  return null;
}

/**
 * A title a person can read, built only from what the alarm carries.
 *
 * `metricName` and the resource dimension, nothing else — so `CPUUtilization` on `redis-prod` reads as
 * exactly that. The caller translates the metric where it has a name for it; where it does not, the AWS
 * metric name is shown, which is still better than the alarm's name. A composite alarm has no metric and
 * gets no derived title: the page shows its own name and says it is a rule over other alarms.
 */
export function titleParts(alarm: { metricName: string | null; dimensions: Record<string, string> }): { metric: string; resource: string | null } | null {
  if (alarm.metricName === null) return null;
  const resource = resourceOf(alarm);
  return { metric: alarm.metricName, resource: resource?.value ?? null };
}

/** How long the condition has to hold, in seconds, or null where the alarm does not say. */
export function windowSeconds(alarm: { period: number | null; evaluationPeriods: number | null }): number | null {
  return alarm.period === null || alarm.evaluationPeriods === null ? null : alarm.period * alarm.evaluationPeriods;
}

export type AlarmCounts = { total: number; ALARM: number; OK: number; INSUFFICIENT_DATA: number };

/**
 * The summary at the top of the page.
 *
 * `INSUFFICIENT_DATA` is counted separately and never folded into either of the others. An alarm AWS
 * could not evaluate is not a passing alarm, and adding it to OK is how a dashboard reports health it
 * has not got.
 */
export function countStates(alarms: readonly { state: 'OK' | 'ALARM' | 'INSUFFICIENT_DATA' }[]): AlarmCounts {
  const counts: AlarmCounts = { total: alarms.length, ALARM: 0, OK: 0, INSUFFICIENT_DATA: 0 };
  for (const alarm of alarms) counts[alarm.state] += 1;
  return counts;
}

/** How recently the state changed, for the "changed lately" view. Null where AWS reported no timestamp. */
export function changedWithin(alarm: { stateUpdatedAt: number | null }, nowMs: number, windowMs: number): boolean {
  return alarm.stateUpdatedAt !== null && nowMs - alarm.stateUpdatedAt <= windowMs;
}

/**
 * CloudWatch metric name → the key of a phrase OpsWatch has for it.
 *
 * Only metrics whose meaning is unambiguous are listed. Anything else keeps its AWS name, which is a real
 * identifier an operator can search for — unlike a translated guess at what somebody's custom metric means.
 * `CPUUtilization` means the same thing in three namespaces, so the map is keyed on the metric alone.
 */
const METRIC_KEYS: Record<string, string> = {
  CPUUtilization: 'cpu',
  MemoryUtilization: 'memory',
  EngineCPUUtilization: 'engineCpu',
  DatabaseMemoryUsagePercentage: 'memory',
  FreeableMemory: 'freeableMemory',
  FreeStorageSpace: 'freeStorage',
  DatabaseConnections: 'connections',
  CurrConnections: 'connections',
  ReadLatency: 'readLatency',
  WriteLatency: 'writeLatency',
  ReplicaLag: 'replicaLag',
  Evictions: 'evictions',
  RequestCount: 'requests',
  HTTPCode_Target_5XX_Count: 'target5xx',
  HTTPCode_ELB_5XX_Count: 'elb5xx',
  TargetResponseTime: 'responseTime',
  UnHealthyHostCount: 'unhealthyHosts',
  HealthyHostCount: 'healthyHosts',
  RunningTaskCount: 'runningTasks',
  DesiredTaskCount: 'desiredTasks',
  StatusCheckFailed: 'statusCheck',
  StatusCheckFailed_Instance: 'statusCheck',
  StatusCheckFailed_System: 'statusCheck',
  Throttles: 'throttles',
  Duration: 'duration',
  ApproximateNumberOfMessagesVisible: 'queueDepth',
  ApproximateAgeOfOldestMessage: 'queueAge',
};

/**
 * The phrase key for a metric, or `null` where OpsWatch has no phrase and the caller should print the AWS
 * name unchanged. Never a fallback string: the caller decides, and a missing phrase must not become a
 * rendered message key.
 */
export function metricKey(metricName: string | null): string | null {
  if (metricName === null) return null;
  return METRIC_KEYS[metricName] ?? null;
}
