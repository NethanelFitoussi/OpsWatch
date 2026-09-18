import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveTestResult } from '@/lib/connections/repository';
import { DEFAULT_SETTINGS } from '@/lib/settings/shared';
import type { Db } from '@/lib/db/client';
import { createTestDb } from '../helpers/db';
import { NOW, createReadyRoleConnection } from '../helpers/fixtures';

class RedirectSignal extends Error {
  constructor(public readonly target: unknown) {
    super('NEXT_REDIRECT');
  }
}
class NotFoundSignal extends Error {}

const state = vi.hoisted(() => ({ db: undefined as unknown as Db, signedIn: true, getDb: vi.fn() }));

vi.mock('@/lib/auth/route', () => ({
  initProtectedRoute: async (params: Promise<{ locale: string }>) => {
    const { locale } = await params;
    if (!state.signedIn) throw new RedirectSignal({ href: '/login', locale });
    return { locale, adminId: 1 };
  },
}));
vi.mock('@/lib/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/client')>()),
  getDb: () => state.getDb(),
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

const { initMonitoringRoute } = await import('@/lib/monitoring/route');

beforeEach(() => {
  state.db = createTestDb();
  state.signedIn = true;
  state.getDb.mockReset();
  state.getDb.mockImplementation(() => state.db);
});

const params = (connectionId: string, region = 'eu-west-1') => Promise.resolve({ locale: 'en', connectionId, region });

describe('initMonitoringRoute', () => {
  it('checks the session before reading any connection', async () => {
    state.signedIn = false;
    await expect(initMonitoringRoute(params('abc123def456'))).rejects.toBeInstanceOf(RedirectSignal);
    expect(state.getDb).not.toHaveBeenCalled();
  });

  it('answers not found for an unknown connection or an unconfigured region', async () => {
    const row = saveTestResult(state.db, createReadyRoleConnection(state.db).id, { overall: 'ok', accountMatches: true, checks: [], testedAt: NOW.toISOString() }, NOW);
    await expect(initMonitoringRoute(params('000000000000'))).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(initMonitoringRoute(params(row.id, 'us-east-1'))).rejects.toBeInstanceOf(NotFoundSignal);
  });

  it('sends an unusable connection to its connection page', async () => {
    const row = createReadyRoleConnection(state.db);
    await expect(initMonitoringRoute(params(row.id))).rejects.toMatchObject({ target: { href: `/accounts/${row.id}`, locale: 'en' } });
  });

  it('returns the locale, scope and connection summary', async () => {
    const row = saveTestResult(state.db, createReadyRoleConnection(state.db).id, { overall: 'degraded', accountMatches: true, checks: [], testedAt: NOW.toISOString() }, NOW);
    expect(await initMonitoringRoute(params(row.id))).toEqual({
      locale: 'en',
      scope: { connectionId: row.id, region: 'eu-west-1' },
      connection: { id: row.id, name: 'production', regions: ['eu-west-1'], status: 'degraded' },
      // Every page reads the instance settings from the context, so no card pays its own round trip.
      settings: DEFAULT_SETTINGS,
    });
  });
});
