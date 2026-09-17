import { CloudWatchClient, ListMetricsCommand } from '@aws-sdk/client-cloudwatch';
import { CloudWatchLogsClient, DescribeLogGroupsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { ECSClient, ListClustersCommand } from '@aws-sdk/client-ecs';
import { DescribeLoadBalancersCommand, ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';
import { ListAvailableResourceMetricsCommand, PIClient } from '@aws-sdk/client-pi';
import { DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { classifyError, overallStatus, runPermissionTest } from '@/lib/aws/permissions';
import type { ServiceCheck } from '@/lib/connections/types';

const sts = mockClient(STSClient);
const ecs = mockClient(ECSClient);
const elb = mockClient(ElasticLoadBalancingV2Client);
const rds = mockClient(RDSClient);
const pi = mockClient(PIClient);
const cw = mockClient(CloudWatchClient);
const logs = mockClient(CloudWatchLogsClient);

const credentials = { accessKeyId: 'ASIA', secretAccessKey: 's', sessionToken: 't' };
const now = () => new Date('2026-09-17T10:00:00Z');
const denied = (name = 'AccessDeniedException') => Object.assign(new Error('denied'), { name });

function allowEverything() {
  sts.on(GetCallerIdentityCommand).resolves({ Account: '111122223333', Arn: 'arn:aws:sts::111122223333:assumed-role/OpsWatchReadOnly-x/s' });
  ecs.on(ListClustersCommand).resolves({ clusterArns: [] });
  elb.on(DescribeLoadBalancersCommand).resolves({ LoadBalancers: [] });
  rds.on(DescribeDBInstancesCommand).resolves({
    DBInstances: [{ DBInstanceIdentifier: 'db-1', PerformanceInsightsEnabled: true, DbiResourceId: 'db-ABC' }],
  });
  pi.on(ListAvailableResourceMetricsCommand).resolves({ Metrics: [] });
  cw.on(ListMetricsCommand).resolves({ Metrics: [] });
  logs.on(DescribeLogGroupsCommand).resolves({ logGroups: [] });
}

beforeEach(() => {
  for (const m of [sts, ecs, elb, rds, pi, cw, logs]) m.reset();
});

describe('classifyError', () => {
  it('maps access errors to denied and the rest to error', () => {
    expect(classifyError(denied('AccessDenied'))).toEqual({ status: 'denied', errorCode: 'AccessDenied' });
    expect(classifyError(denied('UnauthorizedOperation'))).toEqual({ status: 'denied', errorCode: 'UnauthorizedOperation' });
    expect(classifyError(denied('ThrottlingException'))).toEqual({ status: 'error', errorCode: 'ThrottlingException' });
    expect(classifyError(denied('TimeoutError'))).toEqual({ status: 'error', errorCode: 'Timeout' });
  });
});

describe('overallStatus', () => {
  const check = (status: ServiceCheck['status']): ServiceCheck => ({
    service: 'ecs', region: 'eu-west-1', action: 'ecs:ListClusters', status, checkedAt: '',
  });
  it('is ok, degraded or failed', () => {
    expect(overallStatus(true, [check('ok'), check('not_applicable')])).toBe('ok');
    expect(overallStatus(true, [check('ok'), check('denied')])).toBe('degraded');
    expect(overallStatus(true, [check('denied'), check('error'), check('not_applicable')])).toBe('failed');
    expect(overallStatus(false, [check('ok')])).toBe('failed');
  });
});

describe('runPermissionTest', () => {
  it('reports every service ok, in order, for each region', async () => {
    allowEverything();
    const result = await runPermissionTest({ expectedAccountId: '111122223333', regions: ['eu-west-1', 'us-east-1'], credentials, now });
    expect(result.overall).toBe('ok');
    expect(result.accountMatches).toBe(true);
    expect(result.checks.map((c) => `${c.region}:${c.service}:${c.status}`)).toEqual([
      'eu-west-1:ecs:ok', 'eu-west-1:elb:ok', 'eu-west-1:rds:ok', 'eu-west-1:pi:ok', 'eu-west-1:cloudwatch:ok', 'eu-west-1:logs:ok',
      'us-east-1:ecs:ok', 'us-east-1:elb:ok', 'us-east-1:rds:ok', 'us-east-1:pi:ok', 'us-east-1:cloudwatch:ok', 'us-east-1:logs:ok',
    ]);
    expect(pi.commandCalls(ListAvailableResourceMetricsCommand)[0].args[0].input).toMatchObject({ ServiceType: 'RDS', Identifier: 'db-ABC' });
    expect(result.testedAt).toBe('2026-09-17T10:00:00.000Z');
  });

  it('is degraded when one service is denied and names the action', async () => {
    allowEverything();
    logs.on(DescribeLogGroupsCommand).rejects(denied());
    const result = await runPermissionTest({ expectedAccountId: '111122223333', regions: ['eu-west-1'], credentials, now });
    expect(result.overall).toBe('degraded');
    expect(result.checks.find((c) => c.service === 'logs')).toMatchObject({
      status: 'denied', action: 'logs:DescribeLogGroups', errorCode: 'AccessDeniedException',
    });
  });

  it('marks Performance Insights not applicable when no instance has it', async () => {
    allowEverything();
    rds.on(DescribeDBInstancesCommand).resolves({ DBInstances: [{ DBInstanceIdentifier: 'db-1', PerformanceInsightsEnabled: false }] });
    const result = await runPermissionTest({ expectedAccountId: '111122223333', regions: ['eu-west-1'], credentials, now });
    expect(result.checks.find((c) => c.service === 'pi')?.status).toBe('not_applicable');
    expect(pi.commandCalls(ListAvailableResourceMetricsCommand)).toHaveLength(0);
  });

  it('fails without calling services when the account does not match', async () => {
    allowEverything();
    const result = await runPermissionTest({ expectedAccountId: '999999999999', regions: ['eu-west-1'], credentials, now });
    expect(result).toMatchObject({ overall: 'failed', accountMatches: false, identityError: 'AccountMismatch', checks: [] });
    expect(ecs.commandCalls(ListClustersCommand)).toHaveLength(0);
  });

  it('fails when the identity call itself fails', async () => {
    sts.on(GetCallerIdentityCommand).rejects(denied('InvalidClientTokenId'));
    const result = await runPermissionTest({ expectedAccountId: '111122223333', regions: ['eu-west-1'], credentials, now });
    expect(result).toMatchObject({ overall: 'failed', identityError: 'InvalidClientTokenId', checks: [] });
  });

  it('times out a hanging call', async () => {
    allowEverything();
    ecs.on(ListClustersCommand).callsFake(() => new Promise(() => {}));
    const result = await runPermissionTest({
      expectedAccountId: '111122223333', regions: ['eu-west-1'], credentials, now, timeoutMs: 30,
    });
    expect(result.checks.find((c) => c.service === 'ecs')).toMatchObject({ status: 'error', errorCode: 'Timeout' });
    expect(result.overall).toBe('degraded');
  });
});
