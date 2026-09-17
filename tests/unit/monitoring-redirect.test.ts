import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveTestResult } from '@/lib/connections/repository';
import type { Db } from '@/lib/db/client';
import { createTestDb } from '../helpers/db';
import { NOW, createReadyRoleConnection } from '../helpers/fixtures';

class RedirectSignal extends Error {
  constructor(public readonly target: unknown) {
    super('NEXT_REDIRECT');
  }
}
class NotFoundSignal extends Error {}

const state = vi.hoisted(() => ({ db: undefined as unknown as Db, signedIn: true }));

vi.mock('@/lib/auth/route', () => ({
  initProtectedRoute: async () => {
    if (!state.signedIn) throw new RedirectSignal({ href: '/login', locale: 'en' });
    return { locale: 'en', adminId: 1 };
  },
}));
vi.mock('@/lib/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/client')>()),
  getDb: () => state.db,
}));
vi.mock('@/i18n/navigation', () => ({
  redirect: (target: unknown) => {
    throw new RedirectSignal(target);
  },
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new NotFoundSignal();
  },
}));

const { default: MonitoringRedirect } = await import('@/app/[locale]/(app)/[section]/page');

const params = (section: string) => ({ params: Promise.resolve({ locale: 'en', section }) });

beforeEach(() => {
  state.db = createTestDb();
  state.signedIn = true;
});

describe('monitoring section redirect', () => {
  it('answers not found for an unknown section', async () => {
    await expect(MonitoringRedirect(params('nope'))).rejects.toBeInstanceOf(NotFoundSignal);
  });

  it('sends to Accounts when no connection can be monitored', async () => {
    createReadyRoleConnection(state.db);
    await expect(MonitoringRedirect(params('alarms'))).rejects.toMatchObject({ target: { href: '/accounts', locale: 'en' } });
  });

  it('opens the section for the first usable connection and its first region', async () => {
    const id = createReadyRoleConnection(state.db, { regions: ['eu-west-3', 'eu-west-1'] }).id;
    saveTestResult(state.db, id, { overall: 'ok', accountMatches: true, checks: [], testedAt: NOW.toISOString() }, NOW);
    await expect(MonitoringRedirect(params('alarms'))).rejects.toMatchObject({
      target: { href: `/c/${id}/eu-west-3/alarms`, locale: 'en' },
    });
  });

  it('checks the session before the section', async () => {
    state.signedIn = false;
    await expect(MonitoringRedirect(params('nope'))).rejects.toMatchObject({ target: { href: '/login', locale: 'en' } });
  });
});
