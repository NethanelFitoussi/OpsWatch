import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/client';
import { createTestDb } from '../helpers/db';

class RedirectSignal extends Error {
  constructor(public readonly target: unknown) {
    super('NEXT_REDIRECT');
  }
}

const state = vi.hoisted(() => ({ db: undefined as unknown as Db }));

vi.mock('@/lib/auth/current', () => ({ requireAdmin: async () => 1 }));
vi.mock('@/lib/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/client')>()),
  getDb: () => state.db,
}));
vi.mock('@/lib/env', () => ({ env: () => ({ OPSWATCH_SECRET: 'k'.repeat(32), OPSWATCH_TEMPLATE_BUCKET: 'bucket' }) }));
vi.mock('@/i18n/navigation', () => ({
  redirect: (target: unknown) => {
    throw new RedirectSignal(target);
  },
}));
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
