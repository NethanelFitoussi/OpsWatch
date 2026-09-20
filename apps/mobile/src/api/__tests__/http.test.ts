import { z } from 'zod';
import { buildUrl, request } from '../http';
import { ApiError, isTransient } from '../errors';

type Reply = { status: number; body?: unknown; headers?: Record<string, string>; url?: string } | 'network' | 'hang';

function fakeFetch(replies: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const reply = replies.shift() ?? { status: 500 };
    if (reply === 'network') throw new TypeError('Network request failed');
    if (reply === 'hang') {
      return new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    }
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.body,
      url: reply.url,
      headers: { get: (name: string) => reply.headers?.[name.toLowerCase()] ?? null },
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const schema = z.object({ value: z.number() });
const transport = (impl: typeof fetch) => ({ baseUrl: 'https://ops.example.com/base', fetchImpl: impl, sleep: async () => undefined, random: () => 0.5, locale: 'fr' });

it('builds urls under a sub-path with repeated and empty parameters handled', () => {
  expect(buildUrl('https://ops.example.com/base', '/api/v1/problems', { env: 'p', severity: ['critical', 'warning'], status: undefined, q: '' })).toBe(
    'https://ops.example.com/base/api/v1/problems?env=p&severity=critical&severity=warning',
  );
});

it('sends the bearer token and locale, never cookies, and validates the answer', async () => {
  const { impl, calls } = fakeFetch([{ status: 200, body: { value: 1, extra: 'ignored' } }]);
  await expect(request(transport(impl), { path: '/x', schema, token: 'tok' })).resolves.toEqual({ value: 1 });
  const headers = calls[0]!.init.headers as Record<string, string>;
  expect(headers.Authorization).toBe('Bearer tok');
  expect(headers['Accept-Language']).toBe('fr');
  expect(calls[0]!.init.credentials).toBe('omit');
});

it('retries idempotent requests on transient failures, then succeeds', async () => {
  const { impl, calls } = fakeFetch(['network', { status: 503 }, { status: 200, body: { value: 2 } }]);
  await expect(request(transport(impl), { path: '/x', schema })).resolves.toEqual({ value: 2 });
  expect(calls).toHaveLength(3);
});

it('never retries a POST unless marked idempotent', async () => {
  const { impl, calls } = fakeFetch(['network', { status: 200, body: { value: 3 } }]);
  await expect(request(transport(impl), { method: 'POST', path: '/x', schema, body: {} })).rejects.toMatchObject({ kind: 'network' });
  expect(calls).toHaveLength(1);
});

it('does not retry client errors and keeps the server code and AWS action', async () => {
  const { impl, calls } = fakeFetch([{ status: 403, body: { error: 'aws_denied', action: 'logs:StartQuery', code: 'AccessDenied' } }]);
  const error = await request(transport(impl), { path: '/x', schema }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ kind: 'forbidden', code: 'aws_denied', action: 'logs:StartQuery' });
  expect(calls).toHaveLength(1);
});

it('reports contract drift as invalid_response without leaking values', async () => {
  const { impl } = fakeFetch([{ status: 200, body: { value: 'secret-looking-string' } }]);
  const error = (await request(transport(impl), { path: '/x', schema }).catch((e: unknown) => e)) as ApiError;
  expect(error.kind).toBe('invalid_response');
  expect(error.message).toContain('value');
  expect(error.message).not.toContain('secret-looking-string');
});

it('times out', async () => {
  const { impl } = fakeFetch(['hang', 'hang', 'hang']);
  await expect(request(transport(impl), { path: '/x', schema, timeoutMs: 10, retries: 0 })).rejects.toMatchObject({ kind: 'timeout' });
});

it('waits as long as a rate-limited server asks, capped at 30 s', async () => {
  const slept: number[] = [];
  const sleep = async (ms: number) => {
    slept.push(ms);
  };
  const asked = fakeFetch([{ status: 429, body: { error: 'rate_limited' }, headers: { 'retry-after': '2' } }, { status: 200, body: { value: 9 } }]);
  await expect(request({ ...transport(asked.impl), sleep }, { path: '/x', schema })).resolves.toEqual({ value: 9 });
  expect(slept).toEqual([2000]);

  slept.length = 0;
  const huge = fakeFetch([{ status: 429, body: { error: 'rate_limited' }, headers: { 'retry-after': '9999' } }, { status: 200, body: { value: 9 } }]);
  await request({ ...transport(huge.impl), sleep }, { path: '/x', schema });
  expect(slept).toEqual([30_000]);
});

it('ignores an HTTP-date Retry-After and backs off instead', async () => {
  const slept: number[] = [];
  const { impl } = fakeFetch([{ status: 503, body: {}, headers: { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' } }, { status: 200, body: { value: 1 } }]);
  await request({ ...transport(impl), sleep: async (ms: number) => void slept.push(ms) }, { path: '/x', schema });
  expect(slept[0]).toBeGreaterThan(0);
  expect(slept[0]).toBeLessThan(2000);
});

it('refuses an answer that came from another origin', async () => {
  const { impl } = fakeFetch([{ status: 200, body: { value: 1 }, url: 'https://evil.example.com/api/v1/x' }]);
  await expect(request(transport(impl), { path: '/x', schema, retries: 0 })).rejects.toMatchObject({ kind: 'invalid_response' });
});

it('accepts an answer from the same origin', async () => {
  const { impl } = fakeFetch([{ status: 200, body: { value: 1 }, url: 'https://ops.example.com/base/x' }]);
  await expect(request(transport(impl), { path: '/x', schema })).resolves.toEqual({ value: 1 });
});

it('classifies transient errors', () => {
  expect(isTransient(new ApiError('server', { status: 502 }))).toBe(true);
  expect(isTransient(new ApiError('server', { status: 500 }))).toBe(false);
  expect(isTransient(new ApiError('rate_limited'))).toBe(true);
  expect(isTransient(new ApiError('unauthorized'))).toBe(false);
});
