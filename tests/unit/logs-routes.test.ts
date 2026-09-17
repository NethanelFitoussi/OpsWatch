import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReadyRoleConnection, NOW } from '../helpers/fixtures';
import { createTestDb } from '../helpers/db';
import { saveTestResult } from '@/lib/connections/repository';
import type { Db } from '@/lib/db/client';
import type { QueryBindings } from '@/lib/monitoring/query-bindings';

const state = vi.hoisted(() => ({
  db: undefined as unknown as Db,
  session: { adminId: 1, sessionId: 'session-a' } as { adminId: number; sessionId: string } | null,
  bindings: undefined as unknown as QueryBindings,
}));
vi.mock('@/lib/auth/current', () => ({ getCurrentSession: async () => state.session }));
vi.mock('@/lib/db/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/db/client')>()), getDb: () => state.db }));
vi.mock('@/lib/env', () => ({ env: () => ({ OPSWATCH_SECRET: 'k'.repeat(32), OPSWATCH_PUBLIC_URL: 'http://localhost:3000' }) }));
// The routes share one process-wide binding store; every test gets its own so none can pass on another's query.
vi.mock('@/lib/monitoring/query-bindings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/monitoring/query-bindings')>()),
  queryBindings: {
    bind: (queryId, binding) => state.bindings.bind(queryId, binding),
    matches: (queryId, binding) => state.bindings.matches(queryId, binding),
    forget: (queryId) => state.bindings.forget(queryId),
  } satisfies QueryBindings,
}));
vi.mock('@/lib/monitoring/target', () => ({
  resolveTarget: vi.fn(async (scope: object) => ({ ok: true, data: { ...scope, credentials: { accessKeyId: 'A', secretAccessKey: 'S' } } })),
}));
vi.mock('@/lib/monitoring/logs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/monitoring/logs')>()),
  startLogsQuery: vi.fn(async () => ({ ok: true, data: { queryId: 'q-1' } })),
  getLogsQueryResults: vi.fn(async () => ({ ok: true, data: { status: 'Running', fields: [], rows: [], statistics: { recordsMatched: 0, recordsScanned: 0, bytesScanned: 0 } } })),
  stopLogsQuery: vi.fn(async () => ({ ok: false, reason: 'error', code: 'SyntaxError', action: 'logs:StopQuery' })),
}));

const { POST } = await import('@/app/api/connections/[id]/regions/[region]/logs/query/route');
const { GET, DELETE } = await import('@/app/api/connections/[id]/regions/[region]/logs/query/[queryId]/route');
const logs = await import('@/lib/monitoring/logs');
const { createQueryBindings, queryBindings } = await import('@/lib/monitoring/query-bindings');

const ORIGIN = { origin: 'http://localhost:3000', 'content-type': 'application/json' };
const nowSeconds = () => Math.floor(Date.now() / 1000);
const body = (overrides = {}) => JSON.stringify({ logGroups: ['/ecs/web'], query: 'fields @message', startSeconds: nowSeconds() - 3600, endSeconds: nowSeconds(), ...overrides });
const url = (id: string, region: string, queryId?: string) => `http://localhost:3000/api/connections/${id}/regions/${region}/logs/query${queryId ? `/${queryId}` : ''}`;
const post = (id: string, region: string, init: { headers?: Record<string, string>; body?: string } = {}) =>
  POST(new Request(url(id, region), { method: 'POST', headers: init.headers ?? ORIGIN, body: init.body ?? body() }), { params: Promise.resolve({ id, region }) });
const get = (id: string, region: string, queryId: string) => GET(new Request(url(id, region, queryId)), { params: Promise.resolve({ id, region, queryId }) });
const del = (id: string, region: string, queryId: string, headers: Record<string, string> = ORIGIN) =>
  DELETE(new Request(url(id, region, queryId), { method: 'DELETE', headers }), { params: Promise.resolve({ id, region, queryId }) });

/** A connection that is `ok` in every one of `regions`. */
function usableConnection(regions: string[] = ['eu-west-1'], name = 'production') {
  const row = createReadyRoleConnection(state.db, { regions, name });
  return saveTestResult(state.db, row.id, { overall: 'ok', accountMatches: true, checks: [], testedAt: NOW.toISOString() }, NOW);
}

let usable: { id: string };

beforeEach(() => {
  state.db = createTestDb();
  state.session = { adminId: 1, sessionId: 'session-a' };
  state.bindings = createQueryBindings();
  vi.clearAllMocks();
  usable = usableConnection();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /api/connections/[id]/regions/[region]/logs/query', () => {
  it('refuses a foreign or missing origin before anything else', async () => {
    const foreign = await post(usable.id, 'eu-west-1', { headers: { origin: 'https://evil.example', 'content-type': 'application/json' } });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toEqual({ error: 'forbidden_origin' });
    expect((await post(usable.id, 'eu-west-1', { headers: { 'content-type': 'application/json' } })).status).toBe(403);
    expect(logs.startLogsQuery).not.toHaveBeenCalled();
  });

  it('refuses a signed-out caller', async () => {
    state.session = null;
    const res = await post(usable.id, 'eu-west-1');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('hides an unknown connection or region and refuses an unusable connection', async () => {
    expect((await post('000000000000', 'eu-west-1')).status).toBe(404);
    expect((await post(usable.id, 'us-east-1')).status).toBe(404);
    const pending = createReadyRoleConnection(state.db, { name: 'pending' });
    const res = await post(pending.id, 'eu-west-1');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'connection_unusable' });
    expect(logs.startLogsQuery).not.toHaveBeenCalled();
  });

  it('rejects a body that is not a valid query and a range longer than 24 hours', async () => {
    const invalid = await post(usable.id, 'eu-west-1', { body: 'not json' });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'invalid_query' });
    const tooLong = await post(usable.id, 'eu-west-1', { body: body({ startSeconds: nowSeconds() - 25 * 3600 }) });
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toEqual({ error: 'range_too_long' });
    expect(logs.startLogsQuery).not.toHaveBeenCalled();
  });

  it('starts the query and binds it to the connection, region and session', async () => {
    const start = nowSeconds() - 3600;
    const end = nowSeconds();
    const res = await post(usable.id, 'eu-west-1', { body: body({ startSeconds: start, endSeconds: end }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ queryId: 'q-1' });
    expect(logs.startLogsQuery).toHaveBeenCalledWith(
      { connectionId: usable.id, region: 'eu-west-1', credentials: { accessKeyId: 'A', secretAccessKey: 'S' } },
      { logGroups: ['/ecs/web'], query: 'fields @message', startSeconds: start, endSeconds: end },
    );
    expect(queryBindings.matches('q-1', { connectionId: usable.id, region: 'eu-west-1', sessionId: 'session-a' })).toBe(true);
  });

  it.each([
    ['denied', 403, 'aws_denied', 'AccessDeniedException'],
    ['throttled', 429, 'aws_throttled', 'LimitExceededException'],
    ['error', 502, 'aws_error', 'ServiceUnavailable'],
  ] as const)('turns a %s start into %i', async (reason, status, error, code) => {
    vi.mocked(logs.startLogsQuery).mockResolvedValueOnce({ ok: false, reason, code, action: 'logs:StartQuery' });
    const res = await post(usable.id, 'eu-west-1');
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error, action: 'logs:StartQuery', code });
  });
});

describe('GET /api/connections/[id]/regions/[region]/logs/query/[queryId]', () => {
  async function started(id = usable.id, region = 'eu-west-1') {
    expect((await post(id, region)).status).toBe(200);
    return 'q-1';
  }

  it('returns the results of a query the caller started', async () => {
    const queryId = await started();
    const res = await get(usable.id, 'eu-west-1', queryId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'Running', fields: [], rows: [], statistics: { recordsMatched: 0, recordsScanned: 0, bytesScanned: 0 } });
  });

  it('hides a query from another session, another region and an unknown id', async () => {
    const both = usableConnection(['eu-west-1', 'eu-west-3'], 'two regions');
    await started(both.id);
    expect((await get(both.id, 'eu-west-3', 'q-1')).status).toBe(404);

    state.session = { adminId: 1, sessionId: 'session-b' };
    expect((await get(both.id, 'eu-west-1', 'q-1')).status).toBe(404);
    expect(logs.getLogsQueryResults).not.toHaveBeenCalled();

    state.session = { adminId: 1, sessionId: 'session-a' };
    expect((await get(both.id, 'eu-west-1', 'q-unknown')).status).toBe(404);
  });

  it('forgets a query after ten minutes', async () => {
    const queryId = await started();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 600_000);
    expect((await get(usable.id, 'eu-west-1', queryId)).status).toBe(404);
  });

  it('refuses a signed-out caller', async () => {
    const queryId = await started();
    state.session = null;
    expect((await get(usable.id, 'eu-west-1', queryId)).status).toBe(401);
  });
});

describe('DELETE /api/connections/[id]/regions/[region]/logs/query/[queryId]', () => {
  it('checks the origin before stopping the query', async () => {
    expect((await post(usable.id, 'eu-west-1')).status).toBe(200);
    expect((await del(usable.id, 'eu-west-1', 'q-1', { origin: 'https://evil.example' })).status).toBe(403);
    expect(logs.stopLogsQuery).not.toHaveBeenCalled();
  });

  it('forgets the binding once the stop succeeds', async () => {
    expect((await post(usable.id, 'eu-west-1')).status).toBe(200);
    vi.mocked(logs.stopLogsQuery).mockResolvedValueOnce({ ok: true, data: true });

    const res = await del(usable.id, 'eu-west-1', 'q-1');
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(logs.stopLogsQuery).toHaveBeenCalledWith({ connectionId: usable.id, region: 'eu-west-1', credentials: { accessKeyId: 'A', secretAccessKey: 'S' } }, 'q-1');
    expect((await get(usable.id, 'eu-west-1', 'q-1')).status).toBe(404);
  });

  it('keeps the binding when the stop fails, so a retry can still reach the query, but still answers 204', async () => {
    expect((await post(usable.id, 'eu-west-1')).status).toBe(200);
    // The suite-wide mock already resolves stopLogsQuery to a failure; assert the response contract explicitly.
    const res = await del(usable.id, 'eu-west-1', 'q-1');
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect((await get(usable.id, 'eu-west-1', 'q-1')).status).toBe(200);
  });

  it('never calls stopLogsQuery, and answers 204, when the target cannot be resolved', async () => {
    expect((await post(usable.id, 'eu-west-1')).status).toBe(200);
    const target = await import('@/lib/monitoring/target');
    vi.mocked(target.resolveTarget).mockResolvedValueOnce({ ok: false, reason: 'error', code: 'CredentialsError', action: 'sts:GetCallerIdentity' });

    const res = await del(usable.id, 'eu-west-1', 'q-1');
    expect(res.status).toBe(204);
    expect(logs.stopLogsQuery).not.toHaveBeenCalled();
    expect((await get(usable.id, 'eu-west-1', 'q-1')).status).toBe(200);
  });

  it('hides an unbound query', async () => {
    expect((await del(usable.id, 'eu-west-1', 'q-unbound')).status).toBe(404);
    expect(logs.stopLogsQuery).not.toHaveBeenCalled();
  });
});

describe('the binding store of a test', () => {
  const binding = { connectionId: 'abc123def456', region: 'eu-west-1', sessionId: 'session-a' };

  it('holds what this test bound', () => {
    queryBindings.bind('q-isolation', binding);
    expect(queryBindings.matches('q-isolation', binding)).toBe(true);
  });

  it('never holds what another test bound', () => {
    expect(queryBindings.matches('q-isolation', binding)).toBe(false);
  });
});
