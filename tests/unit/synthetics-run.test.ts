import { describe, expect, it, vi } from 'vitest';
import { MAX_READ_BYTES, RUN_TIMEOUT_MS, runCheck } from '@/lib/synthetics/run';
import { SsrfError } from '@/lib/net/safe-fetch';

const ok = (body: string, status = 200) =>
  vi.fn(async () => new Response(body, { status, headers: { 'content-type': 'text/plain' } })) as never;

describe('§14 — the guard is not optional', () => {
  it('THE RULING: a refused target is a configuration answer, not an outage', () => {
    // "Your service is down" and "this URL points somewhere OpsWatch will not fetch" are different things
    // to tell somebody at 3am, and the second must not be dressed as the first.
    return runCheck(
      { url: 'http://169.254.169.254/latest/meta-data/', method: 'GET', assertions: [] },
      { fetch: vi.fn(async () => { throw new SsrfError('not_public', '169.254.169.254'); }) as never },
    ).then((result) => {
      expect(result.ok).toBe(false);
      expect(result.failureReason).toBe('refused_not_public');
      // Nothing was measured, so nothing is reported as measured.
      expect(result.totalMs).toBeNull();
      expect(result.status).toBeNull();
    });
  });

  it('reports a timeout as a timeout rather than as unreachable', async () => {
    const hanging = vi.fn(async (_url: string, init?: RequestInit) => {
      const signal = init?.signal;
      return await new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }) as never;

    vi.useFakeTimers();
    const promise = runCheck({ url: 'https://example.test/', method: 'GET', assertions: [] }, { fetch: hanging });
    await vi.advanceTimersByTimeAsync(RUN_TIMEOUT_MS + 10);
    const result = await promise;
    vi.useRealTimers();
    expect(result.failureReason).toBe('timeout');
  });

  it('reports an unreachable host as such', async () => {
    const result = await runCheck(
      { url: 'https://example.test/', method: 'GET', assertions: [] },
      { fetch: vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as never },
    );
    expect(result.failureReason).toBe('unreachable');
  });

  it('bounds how much it will read, whatever the server sends', () => {
    expect(MAX_READ_BYTES).toBe(1024 * 1024);
  });
});

describe('what a run measures', () => {
  it('passes a 2xx when no assertion was declared', async () => {
    // Somebody who declared none meant "is it answering".
    const result = await runCheck({ url: 'https://example.test/', method: 'GET', assertions: [] }, { fetch: ok('hi') });
    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(result.totalMs).not.toBeNull();
  });

  it('fails a 5xx when no assertion was declared', async () => {
    const result = await runCheck({ url: 'https://example.test/', method: 'GET', assertions: [] }, { fetch: ok('oops', 503) });
    expect(result).toMatchObject({ ok: false, status: 503 });
  });

  it('evaluates the assertions that were declared', async () => {
    const result = await runCheck(
      { url: 'https://example.test/', method: 'GET', assertions: [{ kind: 'body_contains', value: 'healthy' }] },
      { fetch: ok('status: healthy') },
    );
    expect(result.ok).toBe(true);
    expect(result.assertionResults[0]?.reason).toBe('passed');
  });

  it('fails when an assertion fails, even on a 200', async () => {
    const result = await runCheck(
      { url: 'https://example.test/', method: 'GET', assertions: [{ kind: 'body_contains', value: 'healthy' }] },
      { fetch: ok('status: degraded') },
    );
    expect(result).toMatchObject({ ok: false, status: 200 });
  });

  it('THE RULING: a HEAD request leaves body assertions unevaluated rather than failing them', async () => {
    const result = await runCheck(
      { url: 'https://example.test/', method: 'HEAD', assertions: [{ kind: 'body_contains', value: 'x' }] },
      { fetch: ok('', 200) },
    );
    // There was no body to check, which is not the same as a body that did not contain it.
    expect(result.assertionResults[0]?.reason).toBe('not_evaluated');
    expect(result.ok).toBe(false);
  });

  it('measures a time for a run that completed', async () => {
    let clock = 1000;
    const result = await runCheck(
      { url: 'https://example.test/', method: 'GET', assertions: [] },
      { fetch: ok('hi'), now: () => (clock += 250) },
    );
    expect(result.totalMs).toBeGreaterThan(0);
  });
});

describe('there is no way to turn the guard off', () => {
  it('THE RULING: the module offers no option that disables certificate verification', async () => {
    // §14 says there is no such option anywhere, and the absence is the feature.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../../src/lib/synthetics/run.ts', import.meta.url), 'utf8'),
    );
    for (const escape of ['rejectUnauthorized', 'NODE_TLS_REJECT_UNAUTHORIZED', 'insecure', 'allowSelfSigned']) {
      expect(source, escape).not.toContain(escape);
    }
  });
});
