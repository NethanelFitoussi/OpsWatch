import { CloudWatchClient, ListMetricsCommand } from '@aws-sdk/client-cloudwatch';
import { CloudWatchLogsClient, DescribeLogGroupsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { ECSClient, ListClustersCommand } from '@aws-sdk/client-ecs';
import { DescribeLoadBalancersCommand, ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';
import { ListAvailableResourceMetricsCommand, PIClient } from '@aws-sdk/client-pi';
import { DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import type { AwsCredentialIdentity } from '@smithy/types';
import type { CheckedService, OverallStatus, PermissionTestResult, ServiceCheck } from '../connections/types';
import { clientConfig } from './client-config';
import { awsErrorCode } from './errors';
import { getCallerIdentity } from './identity';

export const CHECK_TIMEOUT_MS = 5000;

export type PermissionTestInput = {
  expectedAccountId: string;
  regions: string[];
  credentials: AwsCredentialIdentity;
  timeoutMs?: number;
  now?: () => Date;
};

const DENIED = /^(AccessDenied|UnauthorizedOperation|AuthorizationError|NotAuthorized)/;

export function classifyError(error: unknown): { status: 'denied' | 'error'; errorCode: string } {
  const code = awsErrorCode(error);
  if (code === 'TimeoutError' || code === 'AbortError') {
    return { status: 'error', errorCode: 'Timeout' };
  }
  return DENIED.test(code) ? { status: 'denied', errorCode: code } : { status: 'error', errorCode: code };
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

function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error(`Timed out after ${timeoutMs} ms`), { name: 'TimeoutError' }));
    }, timeoutMs);
  });
  return Promise.race([run(controller.signal), timeout]).finally(() => clearTimeout(timer));
}

async function check(
  service: CheckedService,
  action: string,
  region: string,
  checkedAt: string,
  timeoutMs: number,
  call: (signal: AbortSignal) => Promise<unknown>,
): Promise<ServiceCheck> {
  try {
    await withTimeout(call, timeoutMs);
    return { service, region, action, status: 'ok', checkedAt };
  } catch (error) {
    return { service, region, action, checkedAt, ...classifyError(error) };
  }
}

async function checkRegion(
  region: string,
  credentials: AwsCredentialIdentity,
  timeoutMs: number,
  checkedAt: string,
): Promise<ServiceCheck[]> {
  const config = clientConfig(region, credentials);
  let piIdentifier: string | undefined;

  const [ecs, elb, rds, cloudwatch, logs] = await Promise.all([
    check('ecs', 'ecs:ListClusters', region, checkedAt, timeoutMs, (abortSignal) =>
      new ECSClient(config).send(new ListClustersCommand({ maxResults: 1 }), { abortSignal }),
    ),
    check('elb', 'elasticloadbalancing:DescribeLoadBalancers', region, checkedAt, timeoutMs, (abortSignal) =>
      new ElasticLoadBalancingV2Client(config).send(new DescribeLoadBalancersCommand({ PageSize: 1 }), { abortSignal }),
    ),
    check('rds', 'rds:DescribeDBInstances', region, checkedAt, timeoutMs, async (abortSignal) => {
      const out = await new RDSClient(config).send(new DescribeDBInstancesCommand({ MaxRecords: 20 }), { abortSignal });
      piIdentifier = out.DBInstances?.find((i) => i.PerformanceInsightsEnabled && i.DbiResourceId)?.DbiResourceId;
    }),
    check('cloudwatch', 'cloudwatch:ListMetrics', region, checkedAt, timeoutMs, (abortSignal) =>
      new CloudWatchClient(config).send(new ListMetricsCommand({ Namespace: 'AWS/ECS' }), { abortSignal }),
    ),
    check('logs', 'logs:DescribeLogGroups', region, checkedAt, timeoutMs, (abortSignal) =>
      new CloudWatchLogsClient(config).send(new DescribeLogGroupsCommand({ limit: 1 }), { abortSignal }),
    ),
  ]);

  // Copied into a const so TypeScript keeps the narrowing inside the callback.
  const identifier: string | undefined = piIdentifier;
  const pi: ServiceCheck =
    rds.status === 'ok' && identifier
      ? await check('pi', 'pi:ListAvailableResourceMetrics', region, checkedAt, timeoutMs, (abortSignal) =>
          new PIClient(config).send(
            new ListAvailableResourceMetricsCommand({ ServiceType: 'RDS', Identifier: identifier, MetricTypes: ['os'] }),
            { abortSignal },
          ),
        )
      : { service: 'pi', region, action: 'pi:ListAvailableResourceMetrics', status: 'not_applicable', checkedAt };

  return [ecs, elb, rds, pi, cloudwatch, logs];
}

export async function runPermissionTest(input: PermissionTestInput): Promise<PermissionTestResult> {
  const testedAt = (input.now ?? (() => new Date()))().toISOString();
  const timeoutMs = input.timeoutMs ?? CHECK_TIMEOUT_MS;

  let identity;
  try {
    identity = await getCallerIdentity(input.credentials, input.regions[0]);
  } catch (error) {
    return { overall: 'failed', accountMatches: false, identityError: awsErrorCode(error), checks: [], testedAt };
  }

  if (identity.account !== input.expectedAccountId) {
    return {
      overall: 'failed',
      accountMatches: false,
      identityArn: identity.arn,
      identityError: 'AccountMismatch',
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
