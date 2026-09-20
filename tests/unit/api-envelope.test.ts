import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { API_ERROR_STATUS, encodeCursor } from '@opswatch/contract';
import { apiFailure, apiJson, apiNoContent } from '@/lib/api/v1/envelope';
import { parseEnvironmentParam, parsePagination } from '@/lib/api/v1/request';

const body = async (response: Response) => response.json() as Promise<Record<string, unknown>>;
const url = (query: string) => new URL(`http://opswatch.test/api/v1/problems${query}`);

describe('the error envelope', () => {
  it('answers snake-case codes with the status the contract fixes', async () => {
    for (const [code, status] of Object.entries(API_ERROR_STATUS)) {
      const response = apiFailure(code as keyof typeof API_ERROR_STATUS);
      expect(response.status).toBe(status);
      expect(await body(response)).toEqual({ error: code });
    }
  });

  it('carries the AWS action and code so a client can name the missing permission', async () => {
    const response = apiFailure('aws_denied', { action: 'logs:StartQuery', awsCode: 'AccessDeniedException' });
    expect(await body(response)).toEqual({ error: 'aws_denied', action: 'logs:StartQuery', code: 'AccessDeniedException' });
  });

  it('says how long to wait after a refusal, in the header rather than the body', async () => {
    const response = apiFailure('rate_limited', { retryAfterSeconds: 60 });
    expect(response.headers.get('retry-after')).toBe('60');
    expect(await body(response)).toEqual({ error: 'rate_limited' });
  });
});

describe('every API response', () => {
  const responses = () => [
    apiJson(z.object({ a: z.number() }), { a: 1 }),
    apiFailure('not_found'),
    apiNoContent(),
  ];

  it('is never cached', () => {
    for (const response of responses()) expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('carries no CORS header, because the API is not open to other origins', () => {
    for (const response of responses()) {
      for (const header of [...response.headers.keys()]) expect(header).not.toMatch(/^access-control-/);
    }
  });

  it('answers 204 with no body at all', async () => {
    const response = apiNoContent();
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('validates what it sends against the contract, so a route cannot drift silently', () => {
    const schema = z.object({ at: z.number() });
    // @ts-expect-error — the drift this guards against is exactly a value the schema rejects.
    expect(() => apiJson(schema, { at: '2026-09-18' })).toThrow(/at/);
  });

  it('sends what the schema produced, so defaults and null are applied once', async () => {
    const schema = z.object({ items: z.array(z.string()), nextCursor: z.string().nullable().default(null) });
    expect(await body(apiJson(schema, { items: [] }))).toEqual({ items: [], nextCursor: null });
  });
});

describe('the cursor and limit convention', () => {
  it('defaults to 50 and no cursor', () => {
    expect(parsePagination(url(''))).toEqual({ ok: true, limit: 50, cursor: null });
  });

  it('accepts 1 to 100 and refuses anything else', () => {
    expect(parsePagination(url('?limit=1'))).toMatchObject({ ok: true, limit: 1 });
    expect(parsePagination(url('?limit=100'))).toMatchObject({ ok: true, limit: 100 });
    for (const limit of ['0', '101', '-1', 'ten', '10.5', '']) {
      expect(parsePagination(url(`?limit=${limit}`))).toEqual({ ok: false, error: 'invalid_request' });
    }
  });

  it('decodes a cursor this server minted and refuses one it did not', () => {
    const cursor = encodeCursor({ seq: 7, id: 'p-1' });
    expect(parsePagination(url(`?cursor=${cursor}`))).toEqual({ ok: true, limit: 50, cursor: { seq: 7, id: 'p-1' } });
    expect(parsePagination(url('?cursor=not-a-cursor'))).toEqual({ ok: false, error: 'invalid_cursor' });
  });
});

describe('the ?env= convention', () => {
  it('reads a connection and region pair', () => {
    expect(parseEnvironmentParam(url('?env=abc123def456:eu-west-1'))).toEqual({
      ok: true,
      environment: { connectionId: 'abc123def456', scope: 'eu-west-1' },
    });
  });

  it('answers nothing when there is no env, so an endpoint that does not need one is unaffected', () => {
    expect(parseEnvironmentParam(url(''))).toEqual({ ok: true, environment: null });
  });

  it('refuses a malformed pair rather than splitting it itself', () => {
    for (const value of ['abc123def456', ':eu-west-1', 'abc:', 'a:b:c', '']) {
      expect(parseEnvironmentParam(url(`?env=${value}`))).toEqual({ ok: false, error: 'invalid_request' });
    }
  });
});
