import 'server-only';
import { CloudWatchClient, ListMetricsCommand } from '@aws-sdk/client-cloudwatch';
import { CloudWatchLogsClient, DescribeLogGroupsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { ECSClient, ListClustersCommand } from '@aws-sdk/client-ecs';
import { DescribeLoadBalancersCommand, ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';
import { ListAvailableResourceMetricsCommand, PIClient } from '@aws-sdk/client-pi';
import { DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import type { AwsCredentialIdentity } from '@smithy/types';
import { clientConfig } from './client-config';
import { awsErrorCode, normalizeAwsErrorCode } from './errors';
import { lookUpCallerIdentity } from './identity';
import type { OpsWatchIdentityError } from './identity-errors';
import type { CheckedService, OverallStatus, PermissionTestResult, ServiceCheck } from './permission-types';
import { AWS_CALL_TIMEOUT_MS, sendWithTimeout } from './timeout';

export type PermissionTestInput = {
  expectedAccountId: string;
  regions: string[];
  credentials: AwsCredentialIdentity;
  timeoutMs?: number;
  now?: () => Date;
};

const DENIED = /^(AccessDenied|UnauthorizedOperation|AuthorizationError|NotAuthorized)/;

export function classifyError(error: unknown): { status: 'denied' | 'error'; errorCode: string } {
  const errorCode = normalizeAwsErrorCode(awsErrorCode(error));
  return { status: DENIED.test(errorCode) ? 'denied' : 'error', errorCode };
}

export function overallStatus(accountMatches: boolean, checks: ServiceCheck[]): OverallStatus {
  if (!accountMatches) {
    return 'failed';
  }
  const relevant = checks.filter((c) => c.status !== 'not_applicable');
  const failing = relevant.filter((c) => c.status !== 'ok');
  if (relevant.length === 0 || failing.length === relevant.length) {
    return 'failed';
  }
  return failing.length === 0 ? 'ok' : 'degraded';
}

async function checkRegion(
  region: string,
  credentials: AwsCredentialIdentity,
  timeoutMs: number,
  checkedAt: string,
): Promise<ServiceCheck[]> {
  const config = clientConfig(region, credentials);

  async function check(service: CheckedService, action: string, call: () => Promise<unknown>): Promise<ServiceCheck> {
    try {
      await call();
      return { service, region, action, status: 'ok', checkedAt };
    } catch (error) {
      return { service, region, action, checkedAt, ...classifyError(error) };
    }
  }

  let piIdentifier: string | undefined;
  const [ecs, elb, rds, cloudwatch, logs] = await Promise.all([
    check('ecs', 'ecs:ListClusters', () =>
      sendWithTimeout(new ECSClient(config), new ListClustersCommand({ maxResults: 1 }), timeoutMs),
    ),
    check('elb', 'elasticloadbalancing:DescribeLoadBalancers', () =>
      sendWithTimeout(new ElasticLoadBalancingV2Client(config), new DescribeLoadBalancersCommand({ PageSize: 1 }), timeoutMs),
    ),
    check('rds', 'rds:DescribeDBInstances', async () => {
      const out = await sendWithTimeout(new RDSClient(config), new DescribeDBInstancesCommand({ MaxRecords: 20 }), timeoutMs);
      piIdentifier = out.DBInstances?.find((i) => i.PerformanceInsightsEnabled && i.DbiResourceId)?.DbiResourceId;
    }),
    check('cloudwatch', 'cloudwatch:ListMetrics', () =>
      sendWithTimeout(new CloudWatchClient(config), new ListMetricsCommand({ Namespace: 'AWS/ECS' }), timeoutMs),
    ),
    check('logs', 'logs:DescribeLogGroups', () =>
      sendWithTimeout(new CloudWatchLogsClient(config), new DescribeLogGroupsCommand({ limit: 1 }), timeoutMs),
    ),
  ]);

  // Copied into a const so TypeScript keeps the narrowing inside the callback.
  const identifier: string | undefined = piIdentifier;
  const piAction = 'pi:ListAvailableResourceMetrics';
  const pi: ServiceCheck =
    rds.status === 'ok' && identifier
      ? await check('pi', piAction, () =>
          sendWithTimeout(
            new PIClient(config),
            new ListAvailableResourceMetricsCommand({ ServiceType: 'RDS', Identifier: identifier, MetricTypes: ['os'] }),
            timeoutMs,
          ),
        )
      : { service: 'pi', region, action: piAction, status: 'not_applicable', checkedAt };

  return [ecs, elb, rds, pi, cloudwatch, logs];
}

export async function runPermissionTest(input: PermissionTestInput): Promise<PermissionTestResult> {
  const testedAt = (input.now ?? (() => new Date()))().toISOString();
  const timeoutMs = input.timeoutMs ?? AWS_CALL_TIMEOUT_MS;

  const { identity, errorCode } = await lookUpCallerIdentity(input.credentials, input.regions[0], timeoutMs);
  if (!identity) {
    return { overall: 'failed', accountMatches: false, identityError: errorCode, checks: [], testedAt };
  }

  if (identity.account !== input.expectedAccountId) {
    return {
      overall: 'failed',
      accountMatches: false,
      identityArn: identity.arn,
      identityError: 'AccountMismatch' satisfies OpsWatchIdentityError,
      checks: [],
      testedAt,
    };
  }

  const perRegion = await Promise.all(
    input.regions.map((region) => checkRegion(region, input.credentials, timeoutMs, testedAt)),
  );
  const checks = perRegion.flat();
  return { overall: overallStatus(true, checks), accountMatches: true, identityArn: identity.arn, checks, testedAt };
}
