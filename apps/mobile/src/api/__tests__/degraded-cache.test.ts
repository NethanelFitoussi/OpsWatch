/**
 * The offline cache lives in unencrypted storage on someone's phone, so it must stay bounded in age and in size, and
 * must never be read back under a session it does not belong to.
 */
import type { Query } from '@tanstack/react-query';
import { ApiError } from '../errors';
import { keys } from '../queries';
import { CACHE_MAX_AGE_MS, cacheBuster, createQueryClient, MAX_PERSISTED_QUERIES, persistableQueryHashes } from '../query-provider';
import type { SessionState } from '@/state/session';

const scope = { env: 'prod' };

type FakeQuery = Pick<Query, 'queryKey' | 'queryHash' | 'state'>;

function query(hash: string, queryKey: readonly unknown[], dataUpdatedAt: number): FakeQuery {
  return { queryHash: hash, queryKey: [...queryKey], state: { status: 'success', dataUpdatedAt } as never };
}

const now = 1_700_000_000_000;

describe('what reaches the disk', () => {
  it('keeps a fresh allowed list and drops everything the allow-list excludes', () => {
    const hashes = persistableQueryHashes(
      [query('health', keys.health(scope), now - 1000), query('logs', keys.logs(scope, { from: 0, to: 1 }), now - 1000)],
      now,
    );
    expect([...hashes]).toEqual(['health']);
  });

  it('drops data older than the cache lifetime, even when the snapshot keeps being rewritten', () => {
    const fresh = query('fresh', keys.health(scope), now - CACHE_MAX_AGE_MS + 60_000);
    const ancient = query('ancient', keys.problems(scope, {}), now - CACHE_MAX_AGE_MS - 1);
    expect([...persistableQueryHashes([fresh, ancient], now)]).toEqual(['fresh']);
  });

  it('caps the number of lists kept, keeping the most recently used ones', () => {
    // Every filter combination is its own query, so an unbounded number of them can pile up in a long session.
    const many = Array.from({ length: MAX_PERSISTED_QUERIES + 10 }, (_, i) => query(`q${i}`, keys.problems(scope, { service: `svc-${i}` }), now - i * 1000));
    const hashes = persistableQueryHashes(many, now);
    expect(hashes.size).toBe(MAX_PERSISTED_QUERIES);
    expect(hashes.has('q0')).toBe(true);
    expect(hashes.has(`q${MAX_PERSISTED_QUERIES}`)).toBe(false);
  });
});

describe('cacheBuster', () => {
  const signedIn: SessionState = {
    status: 'signed-in',
    server: { url: 'https://ops.example.com', demo: false, insecure: false, info: null },
    user: { email: 'a@example.com' },
  };

  it('ties a persisted cache to one server and one user', () => {
    expect(cacheBuster(signedIn)).toBe('https://ops.example.com|a@example.com');
    expect(cacheBuster({ ...signedIn, user: { email: 'b@example.com' } })).not.toBe(cacheBuster(signedIn));
    expect(cacheBuster({ ...signedIn, server: { ...signedIn.server, url: 'https://other.example.com' } })).not.toBe(cacheBuster(signedIn));
  });

  it('never reuses a signed-in cache key while no one is signed in', () => {
    expect(cacheBuster({ status: 'loading' })).toBe('none');
    expect(cacheBuster({ status: 'no-server' })).toBe('none');
    expect(cacheBuster({ status: 'signed-out', server: signedIn.server, reason: 'expired' })).toBe('none');
  });
});

describe('a rejected session', () => {
  async function failWith(error: ApiError, onUnauthorized: jest.Mock): Promise<void> {
    const client = createQueryClient(onUnauthorized);
    await client.fetchQuery({ queryKey: ['x'], queryFn: () => Promise.reject(error), retry: false }).catch(() => undefined);
    client.clear();
  }

  it('ends the session on a 401', async () => {
    const onUnauthorized = jest.fn();
    await failWith(new ApiError('unauthorized', { status: 401 }), onUnauthorized);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('leaves the session alone for every other failure', async () => {
    const onUnauthorized = jest.fn();
    await failWith(new ApiError('forbidden', { status: 403 }), onUnauthorized);
    await failWith(new ApiError('network'), onUnauthorized);
    await failWith(new ApiError('server', { status: 500 }), onUnauthorized);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
