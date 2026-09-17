import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/client';
import { createConnection } from '@/lib/connections/repository';
import { createTestDb } from '../helpers/db';
import { connectionInput } from '../helpers/fixtures';

const state = vi.hoisted(() => ({ db: undefined as unknown as Db, adminId: 1 as number | null }));

vi.mock('@/lib/auth/current', () => ({ getCurrentAdminId: async () => state.adminId }));
vi.mock('@/lib/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/client')>()),
  getDb: () => state.db,
}));
vi.mock('@/lib/aws/identity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/aws/identity')>()),
  detectBaseIdentity: async () => ({ account: '111122223333', arn: 'arn:aws:iam::111122223333:user/opswatch' }),
}));

const { GET } = await import('@/app/api/connections/[id]/template/route');

const BROWSER = { accept: 'text/html', cookie: 'NEXT_LOCALE=fr' };
const SCRIPT = { accept: 'application/json' };

function get(id: string, headers: Record<string, string>) {
  return GET(new NextRequest(`http://localhost/api/connections/${id}/template`, { headers }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  state.db = createTestDb();
  state.adminId = 1;
});

describe('GET /api/connections/[id]/template', () => {
  it('downloads the template of a role connection', async () => {
    const row = createConnection(state.db, connectionInput());
    const res = await get(row.id, BROWSER);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="opswatch-${row.id}.yaml"`);
    expect(await res.text()).toContain(`OpsWatchReadOnly-${row.id}`);
  });

  it('sends a browser back to the accounts list for an unknown connection', async () => {
    const res = await get('unknown00000', BROWSER);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/fr/accounts');
  });

  it('sends a browser back to the connection page for a connection without a template', async () => {
    const row = createConnection(state.db, connectionInput({ method: 'keys' }));
    const res = await get(row.id, BROWSER);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/fr/accounts/${row.id}`);
  });

  it('answers scripts with JSON errors', async () => {
    const keys = createConnection(state.db, connectionInput({ method: 'keys' }));
    expect((await get('unknown00000', SCRIPT)).status).toBe(404);
    const notRole = await get(keys.id, SCRIPT);
    expect(notRole.status).toBe(400);
    expect(await notRole.json()).toEqual({ error: 'not_a_role_connection' });
    state.adminId = null;
    expect((await get(keys.id, SCRIPT)).status).toBe(401);
  });
});
