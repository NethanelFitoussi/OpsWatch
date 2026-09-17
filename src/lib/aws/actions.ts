export const TEMPLATE_VERSION = 1;
export const ROLE_NAME_PREFIX = 'OpsWatchReadOnly-';
export const IAM_POLICY_VERSION = '2012-10-17';
/** Lifetime of assumed-role credentials, and the role's MaxSessionDuration. */
export const ASSUME_ROLE_DURATION_SECONDS = 3600;

type ServiceGroupId = 'ecs' | 'ec2' | 'autoscaling' | 'elb' | 'rds' | 'pi' | 'cloudwatch' | 'logs';

export type ServiceGroup = {
  id: ServiceGroupId;
  actions: readonly string[];
  billedActions: readonly string[];
};

export const SERVICE_GROUPS: readonly ServiceGroup[] = [
  {
    id: 'ecs',
    actions: [
      'ecs:ListClusters',
      'ecs:DescribeClusters',
      'ecs:ListServices',
      'ecs:DescribeServices',
      'ecs:ListTasks',
      'ecs:DescribeTasks',
      'ecs:DescribeTaskDefinition',
      'ecs:ListContainerInstances',
      'ecs:DescribeContainerInstances',
    ],
    billedActions: [],
  },
  {
    id: 'ec2',
    actions: [
      'ec2:DescribeInstances',
      'ec2:DescribeNetworkInterfaces',
      'ec2:DescribeSecurityGroups',
      'ec2:DescribeSubnets',
    ],
    billedActions: [],
  },
  {
    id: 'autoscaling',
    actions: [
      'application-autoscaling:DescribeScalableTargets',
      'application-autoscaling:DescribeScalingPolicies',
    ],
    billedActions: [],
  },
  {
    id: 'elb',
    actions: [
      'elasticloadbalancing:DescribeLoadBalancers',
      'elasticloadbalancing:DescribeTargetGroups',
      'elasticloadbalancing:DescribeListeners',
      'elasticloadbalancing:DescribeRules',
      'elasticloadbalancing:DescribeTargetHealth',
    ],
    billedActions: [],
  },
  {
    id: 'rds',
    actions: ['rds:DescribeDBClusters', 'rds:DescribeDBInstances', 'rds:DescribeDBProxies', 'rds:DescribeEvents'],
    billedActions: [],
  },
  {
    id: 'pi',
    actions: [
      'pi:GetResourceMetrics',
      'pi:DescribeDimensionKeys',
      'pi:GetDimensionKeyDetails',
      'pi:ListAvailableResourceMetrics',
      'pi:ListAvailableResourceDimensions',
    ],
    billedActions: [],
  },
  {
    id: 'cloudwatch',
    actions: ['cloudwatch:GetMetricData', 'cloudwatch:ListMetrics', 'cloudwatch:DescribeAlarms'],
    billedActions: [],
  },
  {
    id: 'logs',
    actions: [
      'logs:DescribeLogGroups',
      'logs:DescribeLogStreams',
      'logs:StartQuery',
      'logs:GetQueryResults',
      'logs:StopQuery',
    ],
    billedActions: ['logs:StartQuery'],
  },
];

export function allActions(): string[] {
  return SERVICE_GROUPS.flatMap((group) => [...group.actions]);
}

/** The policy of the read-only role: every action of the catalogue, on every resource. */
export function readOnlyPolicyDocument() {
  return { Version: IAM_POLICY_VERSION, Statement: [{ Effect: 'Allow', Action: allActions(), Resource: '*' }] };
}

export const BASE_IDENTITY_POLICY = {
  Version: IAM_POLICY_VERSION,
  Statement: [
    {
      Effect: 'Allow',
      Action: 'sts:AssumeRole',
      Resource: `arn:aws:iam::*:role/${ROLE_NAME_PREFIX}*`,
    },
  ],
};
