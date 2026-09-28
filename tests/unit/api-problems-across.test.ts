import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/client';
import { createTestDb } from '../helpers/db';
import { connectionInput } from '../helpers/fixtures';
import { FIXED_NOW, newProblem } from '../helpers/detect';

/**
 * `GET /api/v1/problems/across` — what is wrong anywhere, for a client.
 *
 * `/problems` answers "what is wrong *here*", where *here* was already chosen. A client with three
 * AWS accounts and a Google project has to know where to look before it can ask, so its answer
 * depends on where it started. This is the other question, and the thing it must not do while
 * answering it is flatten the clouds together.
 */

const SECRET = 'k'.repeat(32);
const state = vi.hoisted(() => ({ db: undefined as unknown as Db }));
vi.mock('@/lib/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/client')>()),
  getDb: () => state.db,
}));
vi.mock('@/lib/env', () => ({ env: () => ({ OPSWATCH_SECRET: SECRET, OPSWATCH_PUBLIC_URL: 'http://localhost:3000' }) }));
// Rendering a detector's key into a sentence needs a request-scoped translator, which a unit run has
// no business standing up. The key itself is what this test is about; the wording is held elsewhere.
vi.mock('@/lib/read/render', () => ({ insightRenderer: async () => (key: string) => key }));

const { GET } = await import('@/app/api/v1/problems/across/route');
const { createConnection, createGoogleConnection } = await import('@/lib/connections/repository');
const { createAdmin } = await import('@/lib/auth/admin');
const { createSession } = await import('@/lib/auth/sessions');
const { PASSWORD } = await import('../helpers/fixtures');

/** A real bearer token against a real session, so the test exercises the auth rather than mocking past it. */
let bearer = '';

const google = {
  name: 'analytics',
  projectId: 'my-project',
  projectNumber: '123456789012',
  poolId: 'opswatch',
  providerId: 'opswatch',
  serviceAccount: '',
  regions: ['us-central1'],
};

type Body = { problems?: { provider: string; scope: string }[]; counts?: { total: number; byProvider: Record<string, number> }; truncated?: boolean; error?: string };

const call = async (query = '', token: string | null = bearer): Promise<{ status: number; body: Body }> => {
  const request = new Request(`http://localhost/api/v1/problems/across${query}`, {
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  });
  const response = await GET(request as never, { params: Promise.resolve({}) } as never);
  return { status: response.status, body: (await response.json()) as Body };
};

async function seeded() {
  const db = createTestDb();
  state.db = db;
  const adminId = await createAdmin(db, { email: 'a@example.com', password: PASSWORD }, new Date(FIXED_NOW));
  bearer = createSession(db, adminId, SECRET, new Date(FIXED_NOW), 'api');
  const aws = createConnection(db, connectionInput({ name: 'production' }), new Date(FIXED_NOW));
  const gcp = createGoogleConnection(db, google, SECRET, new Date(FIXED_NOW));
  return { db, aws, gcp };
}

describe('problems across every connection, on the API', () => {
  it('THE RULING: every row says which cloud and which scope it came from', async () => {
    const { db, aws, gcp } = await seeded();
    const { insertProblem } = await import('@/lib/store/problems');
    insertProblem(db, newProblem({ key: 'a'.repeat(32), connectionId: aws.id, scope: 'us-east-1' }));
    insertProblem(db, newProblem({ key: 'g'.repeat(32), connectionId: gcp.id, scope: 'my-project', source: 'gcp', score: 90 }));

    const { status, body } = await call();
    expect(status).toBe(200);
    // A unified list that dropped these would be a list nobody could act on.
    expect(body.problems?.map((problem) => [problem.provider, problem.scope])).toEqual([
      ['gcp', 'my-project'],
      ['aws', 'us-east-1'],
    ]);
  });

  it('THE RULING: the counts are over everything, so filtering does not move them', async () => {
    const { db, aws, gcp } = await seeded();
    const { insertProblem } = await import('@/lib/store/problems');
    insertProblem(db, newProblem({ key: 'a'.repeat(32), connectionId: aws.id, scope: 'us-east-1' }));
    insertProblem(db, newProblem({ key: 'g'.repeat(32), connectionId: gcp.id, scope: 'my-project', source: 'gcp' }));

    const filtered = await call('?provider=gcp');
    expect(filtered.body.problems).toHaveLength(1);
    // A count that moved when a client filtered would answer a different question from the one it
    // looks like it answers, and a client showing it beside the filtered list would repeat that.
    expect(filtered.body.counts).toEqual({ total: 2, byProvider: { aws: 1, gcp: 1, do: 0 } });
  });

  it('refuses a provider that is not one rather than quietly returning everything', async () => {
    await seeded();
    const { status, body } = await call('?provider=azure');
    // Handed everything, a client that misspelled the filter would believe it had asked for Azure.
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_request');
  });

  it('needs a session, like every other read of this installation’s data', async () => {
    await seeded();
    // No token at all, and a token that is not one: neither reads another installation's problems.
    expect((await call('', null)).status).toBe(401);
    expect((await call('', 'not-a-token')).status).toBe(401);
  });
});
