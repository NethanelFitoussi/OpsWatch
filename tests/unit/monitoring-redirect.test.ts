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
vi.mock('@/lib/monitoring/route', () => ({
  initMonitoringRoute: async () => ({ locale: 'en', scope: { connectionId: 'abc123def456', region: 'eu-west-1' } }),
}));

const { default: MonitoringRedirect } = await import('@/app/[locale]/(app)/[section]/page');
const { sectionRedirect } = await import('@/app/[locale]/(app)/c/[connectionId]/[region]/section-redirect');

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
      target: { href: `/c/${id}/eu-west-3/alarms/list`, locale: 'en' },
    });
  });

  it('opens Search for Logs, the sub-page the section landed on before it had any others', async () => {
    const id = createReadyRoleConnection(state.db, { regions: ['eu-west-3'] }).id;
    saveTestResult(state.db, id, { overall: 'ok', accountMatches: true, checks: [], testedAt: NOW.toISOString() }, NOW);
    await expect(MonitoringRedirect(params('logs'))).rejects.toMatchObject({
      target: { href: `/c/${id}/eu-west-3/logs/search`, locale: 'en' },
    });
  });

  it('checks the session before the section', async () => {
    state.signedIn = false;
    await expect(MonitoringRedirect(params('nope'))).rejects.toMatchObject({ target: { href: '/login', locale: 'en' } });
  });
});

describe('section root redirect', () => {
  const open = (section: 'databases' | 'logs', searchParams: Record<string, string | string[] | undefined> = {}) =>
    sectionRedirect(section)({ params: Promise.resolve({ locale: 'en', connectionId: 'abc123def456', region: 'eu-west-1' }), searchParams: Promise.resolve(searchParams) });

  it('opens the section\'s first sub-page', async () => {
    await expect(open('databases')).rejects.toMatchObject({ target: { href: '/c/abc123def456/eu-west-1/databases/instances', locale: 'en' } });
  });

  it('keeps the whole query string, including a repeated parameter', async () => {
    // A shared link carries the time range, and the Logs selection carries one `group` per log group.
    await expect(open('logs', { range: '12h', group: ['/ecs/a', '/ecs/b'] })).rejects.toMatchObject({
      target: { href: '/c/abc123def456/eu-west-1/logs/search?range=12h&group=%2Fecs%2Fa&group=%2Fecs%2Fb', locale: 'en' },
    });
  });
});
