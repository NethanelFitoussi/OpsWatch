import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createConnection } from '@/lib/connections/repository';
import { listAudit } from '@/lib/store/audit';
import type { Db } from '@/lib/db/client';
import { createTestDb } from '../helpers/db';
import { connectionInput } from '../helpers/fixtures';

class RedirectSignal extends Error {
  constructor(public readonly target: unknown) {
    super('NEXT_REDIRECT');
  }
}

const state = vi.hoisted(() => ({ db: undefined as unknown as Db, signedIn: true }));

vi.mock('@/lib/auth/current', () => ({
  requireAdmin: async () => {
    if (!state.signedIn) throw new Error('signed out');
    return 1;
  },
}));
vi.mock('@/lib/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/client')>()),
  getDb: () => state.db,
}));
// A literal: the factory is hoisted above the imports, so it cannot use TEST_SECRET.
vi.mock('@/lib/env', () => ({ env: () => ({ OPSWATCH_SECRET: 'k'.repeat(32), OPSWATCH_TEMPLATE_BUCKET: 'bucket' }) }));
vi.mock('@/i18n/navigation', () => ({
  redirect: (target: unknown) => {
    throw new RedirectSignal(target);
  },
}));
vi.mock('@/lib/aws/identity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/aws/identity')>()),
  detectBaseIdentity: async () => {
    throw Object.assign(new Error('no credentials'), { name: 'CredentialsProviderError' });
  },
}));
// The audit helper reads the caller's address and device from the request headers; there is no request
// here, so they are absent, which is the same shape a background action has.
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
}));

const actions = await import('@/app/[locale]/(app)/accounts/actions');

async function redirectOf(run: Promise<unknown>) {
  try {
    await run;
  } catch (error) {
    if (error instanceof RedirectSignal) return error.target;
    throw error;
  }
  throw new Error('expected a redirect');
}

function form(entries: [string, string][]) {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

beforeEach(() => {
  state.db = createTestDb();
  state.signedIn = true;
});

describe('connection actions on a removed connection', () => {
  it.each([
    ['launchStackAction', () => actions.launchStackAction('fr', 'gone00000000')],
    ['regenerateExternalIdAction', () => actions.regenerateExternalIdAction('fr', 'gone00000000')],
    ['deleteConnectionAction', () => actions.deleteConnectionAction('fr', 'gone00000000')],
    ['saveRoleArnAction', () => actions.saveRoleArnAction('fr', 'gone00000000', {}, form([['roleArn', 'x']]))],
    ['saveAccessKeysAction', () => actions.saveAccessKeysAction('fr', 'gone00000000', {}, form([['accessKeyId', 'x']]))],
  ])('%s goes back to the accounts list', async (_name, run) => {
    expect(await redirectOf(run())).toEqual({ href: '/accounts', locale: 'fr' });
  });
});

describe('connection form actions without a session', () => {
  it.each([
    ['createConnectionAction', (data: FormData) => actions.createConnectionAction('en', {}, data)],
    ['saveRoleArnAction', (data: FormData) => actions.saveRoleArnAction('en', 'abc123def456', {}, data)],
    ['saveAccessKeysAction', (data: FormData) => actions.saveAccessKeysAction('en', 'abc123def456', {}, data)],
  ])('%s reads no form field before the authorization', async (_name, run) => {
    state.signedIn = false;
    const data = form([['name', 'x']]);
    const get = vi.spyOn(data, 'get');
    const getAll = vi.spyOn(data, 'getAll');
    await expect(run(data)).rejects.toThrow('signed out');
    expect(get).not.toHaveBeenCalled();
    expect(getAll).not.toHaveBeenCalled();
  });
});

describe('connection actions and the locale argument', () => {
  it('never redirects to a locale OpsWatch does not have', async () => {
    expect(await redirectOf(actions.deleteConnectionAction('//evil.example', 'gone00000000'))).toEqual({
      href: '/accounts',
      locale: 'en',
    });
  });
});

describe('connection forms echo non-secret values after an error', () => {
  it('keeps the wizard name, account ID and regions', async () => {
    const data = form([
      ['name', 'Kept'],
      ['method', 'keys'],
      ['awsAccountId', '1234 5678 90'],
      ['regions', 'eu-west-3'],
      ['regions', 'us-east-1'],
    ]);
    expect(await actions.createConnectionAction('en', {}, data)).toEqual({
      error: 'account_invalid',
      values: { name: 'Kept', awsAccountId: '1234 5678 90', regions: ['eu-west-3', 'us-east-1'] },
    });
  });

  it('keeps the access key ID but never the secret', async () => {
    const created = await redirectOf(
      actions.createConnectionAction(
        'en',
        {},
        form([['name', 'Keys'], ['method', 'keys'], ['awsAccountId', '111122223333'], ['regions', 'eu-west-1']]),
      ),
    );
    const id = String((created as { href: string }).href).split('/').pop() as string;
    const result = await actions.saveAccessKeysAction(
      'en',
      id,
      {},
      form([['accessKeyId', 'not-a-key'], ['secretAccessKey', 'secret-value-that-must-not-come-back']]),
    );
    expect(result).toEqual({ error: 'keys_invalid', values: { accessKeyId: 'not-a-key' } });
    expect(JSON.stringify(result)).not.toContain('secret-value');
  });
});

describe('launch stack', () => {
  it('logs why the template could not be published and shows the error on the connection page', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const row = createConnection(state.db, connectionInput());
    expect(await redirectOf(actions.launchStackAction('en', row.id))).toEqual({
      href: { pathname: `/accounts/${row.id}`, query: { error: 'launch_failed' } },
      locale: 'en',
    });
    expect(info).toHaveBeenCalledWith(
      JSON.stringify({ event: 'launch_stack', connectionId: row.id, ok: false, errorCode: 'CredentialsProviderError' }),
    );
  });
});

describe('MC-12 — the audit log says which account, and stops promising rows nothing wrote', () => {
  /*
   * `connection_create`, `connection_update`, `connection_delete`, `connection_test` and
   * `credential_rotate` were all in the audit log's closed vocabulary, and not one of them was ever
   * written. Connecting an AWS account, replacing its credential and removing it — which destroys every
   * problem, alert and log source that account produced, irreversibly — left no trace at all.
   */
  const entries = () => listAudit(state.db, {}, 50);

  it('THE RULING: connecting an account is recorded, against that account', async () => {
    await redirectOf(
      actions.createConnectionAction(
        'en',
        {},
        form([
          ['name', 'Production'],
          ['method', 'role'],
          ['awsAccountId', '111122223333'],
          ['regions', 'eu-west-1'],
        ]),
      ),
    );

    const [row] = entries();
    expect(row).toMatchObject({ action: 'connection_create', result: 'ok', subjectType: 'connection' });
    // The point of the column: with two accounts connected, "an account was connected" is not a
    // reviewable statement without saying which.
    expect(row.connectionId).toBe(row.subjectId);
    expect(row.connectionId).not.toBeNull();
  });

  it('THE RULING: removing an account is recorded, with how much went with it', async () => {
    const connection = createConnection(state.db, connectionInput(), new Date('2026-09-17T10:00:00Z'));
    await redirectOf(actions.deleteConnectionAction('en', connection.id));

    const row = entries().find((one) => one.action === 'connection_delete');
    expect(row).toMatchObject({ result: 'ok', connectionId: connection.id, subjectId: connection.id });
    expect(typeof row?.details.rowsRemoved).toBe('number');
  });

  it('records replacing a credential as a credential change, not as an edit', async () => {
    const connection = createConnection(state.db, connectionInput({ method: 'keys' }), new Date('2026-09-17T10:00:00Z'));
    await redirectOf(
      actions.saveAccessKeysAction('en', connection.id, {}, form([
        ['accessKeyId', 'AKIAIOSFODNN7EXAMPLE'],
        ['secretAccessKey', 's'.repeat(40)],
      ])),
    );

    const row = entries().find((one) => one.action === 'credential_rotate');
    expect(row).toMatchObject({ result: 'ok', connectionId: connection.id });
    // And never the credential itself, in any field.
    expect(JSON.stringify(entries())).not.toContain('s'.repeat(40));
    expect(JSON.stringify(entries())).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('records a refused change as refused rather than as a failure', async () => {
    await actions.createConnectionAction('en', {}, form([['name', ''], ['method', 'role'], ['awsAccountId', 'nope'], ['regions', '']]));
    expect(entries()[0]).toMatchObject({ action: 'connection_create', result: 'denied' });
  });

  it('files an installation-wide action against no account, which is a different question', () => {
    // Nothing here connects an account, so nothing may claim one.
    expect(entries().every((row) => row.connectionId === null)).toBe(true);
  });
});
