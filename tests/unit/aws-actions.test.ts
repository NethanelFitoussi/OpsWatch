import { describe, expect, it } from 'vitest';
import { ASSUME_ROLE_DURATION_SECONDS, BASE_IDENTITY_POLICY, SERVICE_GROUPS, TEMPLATE_VERSION, allActions, readOnlyPolicyDocument } from '@/lib/aws/actions';

describe('IAM action catalogue', () => {
  it('lists the 37 read-only actions of the spec without duplicates', () => {
    const actions = allActions();
    expect(actions).toHaveLength(37);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('never grants access to S3, Secrets Manager or SSM', () => {
    expect(allActions().filter((a) => /^(s3|secretsmanager|ssm):/.test(a))).toEqual([]);
  });

  it('only contains describe/list/get style actions plus Logs Insights queries', () => {
    const allowedLogs = ['logs:StartQuery', 'logs:StopQuery', 'logs:GetQueryResults'];
    for (const action of allActions()) {
      const verb = action.split(':')[1];
      expect(/^(Describe|List|Get)/.test(verb) || allowedLogs.includes(action), action).toBe(true);
    }
  });

  it('flags the billed actions without changing the template version', () => {
    expect(SERVICE_GROUPS.filter((g) => g.billedActions.length > 0).map((g) => [g.id, g.billedActions])).toEqual([
      ['cloudwatch', ['cloudwatch:GetMetricData']],
      ['logs', ['logs:StartQuery']],
    ]);
    expect(TEMPLATE_VERSION).toBe(1);
    for (const group of SERVICE_GROUPS) {
      for (const action of group.billedActions) expect(group.actions).toContain(action);
    }
  });

  it('limits OpsWatch base identity to assuming OpsWatch roles', () => {
    expect(BASE_IDENTITY_POLICY.Statement).toEqual([
      { Effect: 'Allow', Action: 'sts:AssumeRole', Resource: 'arn:aws:iam::*:role/OpsWatchReadOnly-*' },
    ]);
  });

  it('builds the read-only policy document from the catalogue', () => {
    expect(readOnlyPolicyDocument()).toEqual({
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Action: allActions(), Resource: '*' }],
    });
    expect(BASE_IDENTITY_POLICY.Version).toBe('2012-10-17');
  });

  it('assumes roles for one hour', () => {
    expect(ASSUME_ROLE_DURATION_SECONDS).toBe(3600);
  });
});
