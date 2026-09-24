import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { MAX_ATTEMPTS, deliver, nextAttemptAt } from '@/lib/notify/deliver';
import { SIGNATURE_HEADER, SIGNATURE_VERSION, TIMESTAMP_HEADER, sign, signingInput, verify, type AlertPayload } from '@/lib/notify/payload';

/**
 * §15: nothing leaves the instance until somebody asks, and whatever does leave can be proved to have
 * come from here.
 *
 * The signature rulings are the ones worth breaking on purpose. A webhook a receiver cannot verify is a
 * webhook anybody can forge, and every shortcut here — signing the payload object instead of the bytes,
 * leaving the timestamp out, comparing with `===` — looks harmless and is not.
 */

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);
const SECRET = 'a-signing-secret';
const payload: AlertPayload = {
  id: 'p1',
  alertId: 'a1',
  kind: 'alert.fired',
  severity: 'critical',
  title: 'Insights.messages.alb_5xx_rate',
  subject: 'app/web/abc',
  environment: 'c1:eu-west-1',
  firedAt: NOW,
  url: null,
};

describe('signing a webhook', () => {
  it('is stable, versioned, and hex', () => {
    const signature = sign(NOW, '{"a":1}', SECRET);
    expect(signature).toMatch(new RegExp(`^${SIGNATURE_VERSION}=[0-9a-f]{64}$`));
    expect(sign(NOW, '{"a":1}', SECRET)).toBe(signature);
  });

  it('THE RULING: the timestamp is inside the signature, so a capture cannot be replayed for ever', () => {
    expect(sign(NOW, '{"a":1}', SECRET)).not.toBe(sign(NOW + 1000, '{"a":1}', SECRET));
    expect(signingInput(NOW, '{"a":1}')).toContain(String(NOW));
  });

  it('THE RULING: a changed body changes the signature', () => {
    expect(sign(NOW, '{"a":1}', SECRET)).not.toBe(sign(NOW, '{"a":2}', SECRET));
  });

  it('is worthless without the secret', () => {
    expect(sign(NOW, '{"a":1}', SECRET)).not.toBe(sign(NOW, '{"a":1}', 'another-secret'));
  });

  it('verifies what it signed, and refuses everything else', () => {
    const signature = sign(NOW, '{"a":1}', SECRET);
    expect(verify(NOW, '{"a":1}', SECRET, signature)).toBe(true);
    expect(verify(NOW + 1, '{"a":1}', SECRET, signature)).toBe(false);
    expect(verify(NOW, '{"a":2}', SECRET, signature)).toBe(false);
    expect(verify(NOW, '{"a":1}', 'wrong', signature)).toBe(false);
    // A length mismatch must not throw: `timingSafeEqual` does, and a crash here is a denial of service.
    expect(verify(NOW, '{"a":1}', SECRET, 'v1=short')).toBe(false);
  });
});

describe('sending one', () => {
  const ok = (status = 200) => vi.fn(async () => new Response('', { status })) as unknown as typeof fetch;

  it('THE RULING: it signs the exact bytes it sends', async () => {
    // Serialising twice would let the two drift, and a receiver would verify a string it never saw.
    const send = vi.fn(async () => new Response('', { status: 200 }));
    await deliver({ url: 'https://example.com/hook' }, payload, SECRET, { fetch: send as unknown as typeof fetch, nowMs: NOW });

    const [, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    const body = init.body as string;
    const headers = init.headers as Record<string, string>;
    expect(headers[TIMESTAMP_HEADER]).toBe(String(NOW));
    expect(verify(NOW, body, SECRET, headers[SIGNATURE_HEADER])).toBe(true);
    expect(JSON.parse(body)).toEqual(payload);
  });

  it('THE RULING: the payload carries no credential and no log line', async () => {
    const send = vi.fn(async () => new Response('', { status: 200 }));
    await deliver({ url: 'https://example.com/hook' }, payload, SECRET, { fetch: send as unknown as typeof fetch, nowMs: NOW });
    const [, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body as string).not.toContain(SECRET);
    // The shape is fixed: anything a receiver needs beyond it, it can come and read.
    expect(Object.keys(JSON.parse(init.body as string)).sort()).toEqual(
      ['alertId', 'environment', 'firedAt', 'id', 'kind', 'severity', 'subject', 'title', 'url'],
    );
  });

  it('refuses to follow a redirect, so a destination cannot be pointed elsewhere after the fact', async () => {
    const send = vi.fn(async () => new Response('', { status: 200 }));
    await deliver({ url: 'https://example.com/hook' }, payload, SECRET, { fetch: send as unknown as typeof fetch, nowMs: NOW });
    const [, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.redirect).toBe('error');
  });

  it('treats a non-2xx as a failure with its status, and never throws', async () => {
    expect(await deliver({ url: 'https://example.com' }, payload, SECRET, { fetch: ok(200), nowMs: NOW })).toMatchObject({ ok: true });
    expect(await deliver({ url: 'https://example.com' }, payload, SECRET, { fetch: ok(500), nowMs: NOW })).toMatchObject({ ok: false, error: 'http_500' });
  });

  it('THE RULING: a network failure is a class, not the receiver’s own words', async () => {
    // An error message can quote a URL or a certificate subject. Neither belongs in an audit log.
    const boom = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED 10.0.0.5:443 for https://secret.internal/hook');
    }) as unknown as typeof fetch;
    const outcome = await deliver({ url: 'https://example.com' }, payload, SECRET, { fetch: boom, nowMs: NOW });
    expect(outcome).toEqual({ ok: false, error: 'network' });
  });
});

describe('retrying', () => {
  it('backs off, and eventually stops', () => {
    expect(nextAttemptAt(1, NOW)).toBe(NOW + 60_000);
    expect(nextAttemptAt(2, NOW)).toBeGreaterThan(nextAttemptAt(1, NOW) as number);
    // THE RULING: a broken destination must not be retried for ever, because that is how it becomes
    // invisible. The last attempt returns null, and the delivery stays in the table as a failure.
    expect(nextAttemptAt(MAX_ATTEMPTS, NOW)).toBeNull();
  });
});

describe('the one property a behavioural test cannot reach', () => {
  it('THE RULING: the signature is compared in constant time', () => {
    // Swapping `timingSafeEqual` for `===` changes no output, so every test above still passes — which is
    // exactly why this one reads the source. A byte-by-byte comparison tells an attacker how much of
    // their guess was right, and that is a real attack on a signature with no visible symptom.
    // The call, not the import: leaving the import in place while comparing with `===` is exactly the
    // mutation this is here to catch.
    const source = readFileSync(new URL('../../src/lib/notify/payload.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/timingSafeEqual\(\s*expected\s*,\s*given\s*\)/);
  });
});
