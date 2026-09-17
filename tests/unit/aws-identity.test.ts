import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectBaseIdentity, getCallerIdentity, resetBaseIdentityCache, trustFor } from '@/lib/aws/identity';

vi.mock('@/lib/aws/base-credentials', () => ({
  baseCredentials: () => async () => ({ accessKeyId: 'BASE-FROM-ENV', secretAccessKey: 'base' }),
}));

const sts = mockClient(STSClient);

beforeEach(() => {
  sts.reset();
  resetBaseIdentityCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('trustFor', () => {
  it('trusts an IAM user by its exact ARN', () => {
    expect(trustFor({ account: '111122223333', arn: 'arn:aws:iam::111122223333:user/ops/opswatch' })).toEqual({
      principal: 'arn:aws:iam::111122223333:user/ops/opswatch',
    });
  });

  it('trusts an assumed role through the account root restricted to that exact role name, at any path', () => {
    expect(
      trustFor({ account: '111122223333', arn: 'arn:aws:sts::111122223333:assumed-role/opswatch-task/abc123' }),
    ).toEqual({
      principal: 'arn:aws:iam::111122223333:root',
      principalArnPatterns: [
        'arn:aws:iam::111122223333:role/opswatch-task',
        'arn:aws:iam::111122223333:role/*/opswatch-task',
      ],
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

  it('signs GetCallerIdentity with the base credentials', async () => {
    sts.on(GetCallerIdentityCommand).resolves({ Account: '111122223333', Arn: 'arn:aws:iam::111122223333:user/o' });
    await detectBaseIdentity('eu-west-1', 0);
    const client = sts.commandCalls(GetCallerIdentityCommand)[0].thisValue as STSClient;
    expect(await (client.config.credentials as () => Promise<unknown>)()).toMatchObject({ accessKeyId: 'BASE-FROM-ENV' });
  });

  it('caches a failure for 30 seconds', async () => {
    sts.on(GetCallerIdentityCommand).rejects(Object.assign(new Error('no creds'), { name: 'CredentialsProviderError' }));
    await expect(detectBaseIdentity('eu-west-1', 0)).rejects.toMatchObject({ name: 'CredentialsProviderError' });
    await expect(detectBaseIdentity('eu-west-1', 29_000)).rejects.toMatchObject({ name: 'CredentialsProviderError' });
    expect(sts.commandCalls(GetCallerIdentityCommand)).toHaveLength(1);

    sts.on(GetCallerIdentityCommand).resolves({ Account: '111122223333', Arn: 'arn:aws:iam::111122223333:user/o' });
    await expect(detectBaseIdentity('eu-west-1', 31_000)).resolves.toMatchObject({ account: '111122223333' });
    expect(sts.commandCalls(GetCallerIdentityCommand)).toHaveLength(2);
  });

  it('fails when AWS returns no account', async () => {
    sts.on(GetCallerIdentityCommand).resolves({});
    await expect(detectBaseIdentity('eu-west-1', 0)).rejects.toThrow(/no account/);
  });
});

describe('getCallerIdentity', () => {
  it('gives up after 5 seconds', async () => {
    vi.useFakeTimers();
    sts.on(GetCallerIdentityCommand).callsFake(() => new Promise(() => {}));
    const call = getCallerIdentity(undefined, 'eu-west-1');
    const outcome = expect(call).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(5000);
    await outcome;
  });
});
