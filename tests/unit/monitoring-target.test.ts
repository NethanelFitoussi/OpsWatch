import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CredentialResolver } from '@/lib/aws/credentials';
import { createConnection, setAccessKeys } from '@/lib/connections/repository';
import type { Db } from '@/lib/db/client';
import { resolveTarget } from '@/lib/monitoring/target';
import { createTestDb } from '../helpers/db';
import { NOW, OTHER_SECRET, TEST_SECRET, connectionInput, createReadyRoleConnection } from '../helpers/fixtures';

const credentials = { accessKeyId: 'ASIA', secretAccessKey: 's', sessionToken: 't' };
let db: Db;
let resolver: CredentialResolver;

beforeEach(() => {
  db = createTestDb();
  resolver = { resolve: vi.fn(async () => credentials), forget: vi.fn() };
});

describe('resolveTarget', () => {
  it('resolves the credentials of the connection for the region', async () => {
    const row = createReadyRoleConnection(db);
    const result = await resolveTarget({ connectionId: row.id, region: 'eu-west-1' }, { db, secret: TEST_SECRET, resolver });
    expect(result).toEqual({ ok: true, data: { connectionId: row.id, region: 'eu-west-1', credentials } });
    expect(resolver.resolve).toHaveBeenCalledWith({ method: 'role', connectionId: row.id, roleArn: row.roleArn, externalId: row.externalId }, 'eu-west-1');
  });

  it('reports a missing connection, unfinished setup and a changed secret as errors', async () => {
    const scope = (connectionId: string) => ({ connectionId, region: 'eu-west-1' });
    expect(await resolveTarget(scope('000000000000'), { db, secret: TEST_SECRET, resolver })).toEqual({ ok: false, reason: 'error', code: 'ConnectionNotFound', action: 'sts:AssumeRole' });

    const draft = createConnection(db, connectionInput({ method: 'keys' }), NOW);
    expect(await resolveTarget(scope(draft.id), { db, secret: TEST_SECRET, resolver })).toMatchObject({ ok: false, reason: 'error', code: 'NotReady' });

    setAccessKeys(db, draft.id, { accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' }, OTHER_SECRET, NOW);
    expect(await resolveTarget(scope(draft.id), { db, secret: TEST_SECRET, resolver })).toMatchObject({ ok: false, reason: 'error', code: 'SecretChanged' });
  });

  it('maps an AssumeRole refusal to a denied failure', async () => {
    const row = createReadyRoleConnection(db);
    vi.mocked(resolver.resolve).mockRejectedValueOnce(Object.assign(new Error('no'), { name: 'AccessDenied' }));
    expect(await resolveTarget({ connectionId: row.id, region: 'eu-west-1' }, { db, secret: TEST_SECRET, resolver })).toEqual({ ok: false, reason: 'denied', code: 'AccessDenied', action: 'sts:AssumeRole' });
  });
});
