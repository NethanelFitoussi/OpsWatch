import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCredentialResolver, type AssumeRoleEvent } from '@/lib/aws/credentials';
import { testRoleArn } from '../helpers/fixtures';

const sts = mockClient(STSClient);
const T0 = Date.parse('2026-09-17T10:00:00Z');
const role = {
  method: 'role' as const,
  connectionId: 'abc123def456',
  roleArn: testRoleArn('abc123def456'),
  externalId: 'ext-id',
};

function assumeRoleResponse(expiresAt: number) {
  return {
    Credentials: {
      AccessKeyId: 'ASIATEMP',
      SecretAccessKey: 'temp-secret',
      SessionToken: 'temp-token',
      Expiration: new Date(expiresAt),
    },
  };
}

/** A resolver whose base identity is a fixed key, so no test reaches the real provider chain. */
function makeResolver(deps: Parameters<typeof createCredentialResolver>[0] = {}) {
  return createCredentialResolver({ ambientProvider: async () => ({ accessKeyId: 'BASE', secretAccessKey: 'base' }), ...deps });
}

beforeEach(() => sts.reset());
afterEach(() => {
  vi.useRealTimers();
});

describe('credential resolver', () => {
  it('assumes the role with the ExternalId, session name and duration', async () => {
    sts.on(AssumeRoleCommand).resolves(assumeRoleResponse(T0 + 3_600_000));
    const events: AssumeRoleEvent[] = [];
    const resolver = makeResolver({
      now: () => T0,
      log: (e) => events.push(e),
    });

    const creds = await resolver.resolve(role, 'eu-west-1');

    expect(creds).toEqual({
      accessKeyId: 'ASIATEMP',
      secretAccessKey: 'temp-secret',
      sessionToken: 'temp-token',
      expiration: new Date(T0 + 3_600_000),
    });
    expect(sts.commandCalls(AssumeRoleCommand)[0].args[0].input).toEqual({
      RoleArn: role.roleArn,
      ExternalId: 'ext-id',
      RoleSessionName: 'opswatch-abc123def456',
      DurationSeconds: 3600,
    });
    expect(events).toEqual([{ event: 'assume_role', connectionId: 'abc123def456', ok: true }]);
  });

  it('reuses cached credentials until 5 minutes before expiry', async () => {
    sts.on(AssumeRoleCommand).resolves(assumeRoleResponse(T0 + 3_600_000));
    let now = T0;
    const resolver = makeResolver({
      now: () => now,
      log: () => {},
    });

    await resolver.resolve(role, 'eu-west-1');
    now = T0 + 54 * 60_000; // 6 minutes left
    await resolver.resolve(role, 'eu-west-1');
    expect(sts.commandCalls(AssumeRoleCommand)).toHaveLength(1);

    now = T0 + 56 * 60_000; // 4 minutes left
    await resolver.resolve(role, 'eu-west-1');
    expect(sts.commandCalls(AssumeRoleCommand)).toHaveLength(2);
  });

  it('assumes again after forget() or when the ExternalId changes', async () => {
    sts.on(AssumeRoleCommand).resolves(assumeRoleResponse(T0 + 3_600_000));
    const resolver = makeResolver({
      now: () => T0,
      log: () => {},
    });
    await resolver.resolve(role, 'eu-west-1');
    await resolver.resolve({ ...role, externalId: 'new-ext-id' }, 'eu-west-1');
    resolver.forget('abc123def456');
    await resolver.resolve(role, 'eu-west-1');
    expect(sts.commandCalls(AssumeRoleCommand)).toHaveLength(3);
  });

  it('logs and rethrows a failed AssumeRole without secrets', async () => {
    sts.on(AssumeRoleCommand).rejects(Object.assign(new Error('not authorized'), { name: 'AccessDenied' }));
    const log = vi.fn();
    const resolver = makeResolver({
      now: () => T0,
      log,
    });
    await expect(resolver.resolve(role, 'eu-west-1')).rejects.toMatchObject({ name: 'AccessDenied' });
    expect(log).toHaveBeenCalledWith({
      event: 'assume_role',
      connectionId: 'abc123def456',
      ok: false,
      errorCode: 'AccessDenied',
    });
  });

  it('gives up on AssumeRole after 5 seconds and logs the timeout', async () => {
    vi.useFakeTimers();
    sts.on(AssumeRoleCommand).callsFake(() => new Promise(() => {}));
    const log = vi.fn();
    const resolver = makeResolver({
      now: () => T0,
      log,
    });
    const outcome = expect(resolver.resolve(role, 'eu-west-1')).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(5000);
    await outcome;
    expect(log).toHaveBeenCalledWith({ event: 'assume_role', connectionId: 'abc123def456', ok: false, errorCode: 'TimeoutError' });
  });

  it('returns ambient credentials from the provider chain', async () => {
    const resolver = makeResolver({ ambientProvider: async () => ({ accessKeyId: 'AMBIENT', secretAccessKey: 'amb' }) });
    expect(await resolver.resolve({ method: 'ambient' }, 'eu-west-1')).toEqual({
      accessKeyId: 'AMBIENT',
      secretAccessKey: 'amb',
    });
  });

  it('returns static access keys', async () => {
    const resolver = makeResolver();
    expect(
      await resolver.resolve({ method: 'keys', accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret' }, 'eu-west-1'),
    ).toEqual({ accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret' });
  });
});
