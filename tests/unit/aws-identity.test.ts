import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { detectBaseIdentity, resetBaseIdentityCache, trustFor } from '@/lib/aws/identity';

const sts = mockClient(STSClient);

beforeEach(() => {
  sts.reset();
  resetBaseIdentityCache();
});

describe('trustFor', () => {
  it('trusts an IAM user by its exact ARN', () => {
    expect(trustFor({ account: '111122223333', arn: 'arn:aws:iam::111122223333:user/ops/opswatch' })).toEqual({
      principal: 'arn:aws:iam::111122223333:user/ops/opswatch',
    });
  });

  it('trusts an assumed role through the account root restricted to that role name', () => {
    expect(
      trustFor({ account: '111122223333', arn: 'arn:aws:sts::111122223333:assumed-role/opswatch-task/abc123' }),
    ).toEqual({
      principal: 'arn:aws:iam::111122223333:root',
      principalArnPattern: 'arn:aws:iam::111122223333:role/*opswatch-task',
    });
  });

  it('falls back to the account root for other identities', () => {
    expect(trustFor({ account: '111122223333', arn: 'arn:aws:iam::111122223333:root' })).toEqual({
      principal: 'arn:aws:iam::111122223333:root',
    });
  });

  it('keeps the partition', () => {
    expect(trustFor({ account: '111122223333', arn: 'arn:aws-us-gov:iam::111122223333:user/x' }).principal).toBe(
      'arn:aws-us-gov:iam::111122223333:user/x',
    );
  });
});

describe('detectBaseIdentity', () => {
  it('calls GetCallerIdentity once and caches the result for 5 minutes', async () => {
    sts.on(GetCallerIdentityCommand).resolves({ Account: '111122223333', Arn: 'arn:aws:iam::111122223333:user/o' });
    const first = await detectBaseIdentity('eu-west-1', 0);
    await detectBaseIdentity('eu-west-1', 4 * 60_000);
    expect(first).toEqual({ account: '111122223333', arn: 'arn:aws:iam::111122223333:user/o' });
    expect(sts.commandCalls(GetCallerIdentityCommand)).toHaveLength(1);
    await detectBaseIdentity('eu-west-1', 6 * 60_000);
    expect(sts.commandCalls(GetCallerIdentityCommand)).toHaveLength(2);
  });

  it('fails when AWS returns no account', async () => {
    sts.on(GetCallerIdentityCommand).resolves({});
    await expect(detectBaseIdentity('eu-west-1', 0)).rejects.toThrow(/no account/);
  });
});
