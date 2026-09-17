import { describe, expect, it } from 'vitest';
import { isSameOrigin } from '@/lib/http/origin';

const req = (headers: Record<string, string>, url = 'http://localhost:3000/api/x') =>
  new Request(url, { method: 'POST', headers });

describe('isSameOrigin', () => {
  it('accepts a matching Origin based on the Host header', () => {
    expect(isSameOrigin(req({ origin: 'http://localhost:3000', host: 'localhost:3000' }))).toBe(true);
  });

  it('honours forwarded host and protocol', () => {
    expect(
      isSameOrigin(req({ origin: 'https://ops.example.com', 'x-forwarded-host': 'ops.example.com', 'x-forwarded-proto': 'https' })),
    ).toBe(true);
  });

  it('prefers the configured public URL', () => {
    expect(isSameOrigin(req({ origin: 'https://ops.example.com', host: 'internal:3000' }), 'https://ops.example.com/')).toBe(true);
    expect(isSameOrigin(req({ origin: 'http://internal:3000', host: 'internal:3000' }), 'https://ops.example.com')).toBe(false);
  });

  it('rejects a missing or foreign Origin', () => {
    expect(isSameOrigin(req({ host: 'localhost:3000' }))).toBe(false);
    expect(isSameOrigin(req({ origin: 'https://evil.example', host: 'localhost:3000' }))).toBe(false);
  });
});
