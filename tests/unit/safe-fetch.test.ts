import { describe, expect, it, vi } from 'vitest';
import type { Dispatcher } from 'undici';
import { MAX_REDIRECTS, SsrfError, isPublicAddress, pinnedLookup, safeFetch, type SafeFetchDeps } from '@/lib/net/safe-fetch';

const PRIVATE = [
  '127.0.0.1',
  '0.0.0.0',
  '10.1.2.3',
  '169.254.169.254', // the cloud metadata service, the reason this exists
  '172.16.0.1',
  '172.31.255.255',
  '192.168.1.1',
  '100.64.0.1',
  '198.18.0.1',
  '224.0.0.1',
  '255.255.255.255',
  '::1',
  '::',
  'fd00::1',
  'fe80::1',
  'ff02::1',
  '::ffff:127.0.0.1',
  '2001:db8::1',
  '64:ff9b::7f00:1',
];
const PUBLIC = ['1.1.1.1', '8.8.8.8', '172.32.0.1', '172.15.255.255', '93.184.216.34', '2606:4700::1111', '2a00:1450::1'];

type Sent = { url: string; init: RequestInit; dispatcher: Dispatcher };

function deps(overrides: Partial<SafeFetchDeps> & { responses?: Response[] } = {}) {
  const sent: Sent[] = [];
  const responses = overrides.responses ?? [];
  const value: SafeFetchDeps = {
    resolve: overrides.resolve ?? (async () => [{ address: '93.184.216.34', family: 4 }]),
    send:
      overrides.send ??
      (async (url, init, dispatcher) => {
        sent.push({ url, init, dispatcher });
        return responses.shift() ?? new Response('ok', { status: 200 });
      }),
  };
  return { deps: value, sent };
}

const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });

describe('address classification', () => {
  it.each(PRIVATE)('refuses %s', (address) => expect(isPublicAddress(address)).toBe(false));
  it.each(PUBLIC)('allows %s', (address) => expect(isPublicAddress(address)).toBe(true));
  it('refuses anything that is not an address at all', () => {
    for (const value of ['', 'example.com', '1.2.3', '999.1.1.1', 'not an address']) {
      expect(isPublicAddress(value)).toBe(false);
    }
  });
});

describe('the pinned lookup', () => {
  const pinned = { address: '93.184.216.34', family: 4 } as const;

  it('answers only the checked address, in both shapes Node asks for', () => {
    const lookup = pinnedLookup(pinned);
    const all = vi.fn();
    lookup('example.com', { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, [pinned]);
    const single = vi.fn();
    lookup('example.com', {}, single);
    expect(single).toHaveBeenCalledWith(null, pinned.address, 4);
  });

  it('ignores the hostname it is handed, so a second DNS answer cannot redirect the connection', () => {
    const callback = vi.fn();
    pinnedLookup(pinned)('anything-else.example', { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [pinned]);
  });
});

describe('safeFetch', () => {
  it('refuses a name that resolves inside the network, without connecting', async () => {
    const { deps: d, sent } = deps({ resolve: async () => [{ address: '169.254.169.254', family: 4 }] });
    await expect(safeFetch('http://metadata.example/latest', {}, d)).rejects.toMatchObject({ reason: 'not_public' });
    expect(sent).toHaveLength(0);
  });

  it('refuses a literal private address just the same', async () => {
    const { deps: d, sent } = deps();
    await expect(safeFetch('http://127.0.0.1:8080/', {}, d)).rejects.toBeInstanceOf(SsrfError);
    expect(sent).toHaveLength(0);
  });

  it('refuses a scheme that is not http or https', async () => {
    const { deps: d } = deps();
    await expect(safeFetch('file:///etc/passwd', {}, d)).rejects.toMatchObject({ reason: 'bad_scheme' });
    await expect(safeFetch('gopher://example.com/', {}, d)).rejects.toMatchObject({ reason: 'bad_scheme' });
  });

  it('refuses a name that resolves to nothing', async () => {
    const { deps: d } = deps({ resolve: async () => [] });
    await expect(safeFetch('https://nowhere.example/', {}, d)).rejects.toMatchObject({ reason: 'unresolvable' });
  });

  it('resolves once and connects through a pinned dispatcher, keeping the hostname for Host and SNI', async () => {
    const resolve = vi.fn(async () => [{ address: '93.184.216.34' as const, family: 4 as const }]);
    const { deps: d, sent } = deps({ resolve });
    await safeFetch('https://example.com/status', {}, d);
    expect(resolve).toHaveBeenCalledTimes(1);
    // The URL is unchanged, so the Host header and the TLS server name are still the hostname the caller gave.
    expect(sent[0].url).toBe('https://example.com/status');
    expect(sent[0].dispatcher).toBeDefined();
  });

  it('never lets the client follow a redirect itself', async () => {
    const { deps: d, sent } = deps({ responses: [redirect('https://example.org/next'), new Response('ok')] });
    await safeFetch('https://example.com/', {}, d);
    expect(sent.every((request) => request.init.redirect === 'manual')).toBe(true);
  });

  it('re-validates and re-pins every hop', async () => {
    const addresses: Record<string, string> = { 'example.com': '93.184.216.34', 'inside.example': '10.0.0.5' };
    const { deps: d, sent } = deps({
      resolve: async (hostname) => [{ address: addresses[hostname] ?? '8.8.8.8', family: 4 }],
      responses: [redirect('https://inside.example/secret')],
    });
    await expect(safeFetch('https://example.com/', {}, d)).rejects.toMatchObject({ reason: 'not_public' });
    // The first hop was made; the second was refused before any connection.
    expect(sent).toHaveLength(1);
  });

  it('stops after three hops', async () => {
    const { deps: d, sent } = deps({
      responses: Array.from({ length: 6 }, (_, index) => redirect(`https://example.com/${index}`)),
    });
    await expect(safeFetch('https://example.com/', {}, d)).rejects.toMatchObject({ reason: 'too_many_redirects' });
    expect(sent).toHaveLength(MAX_REDIRECTS + 1);
  });

  it('hands a redirect back rather than replaying a body it cannot replay', async () => {
    const { deps: d, sent } = deps({ responses: [redirect('https://example.org/next', 307)] });
    const response = await safeFetch('https://example.com/', { method: 'POST', body: 'payload' }, d);
    expect(response.status).toBe(307);
    expect(sent).toHaveLength(1);
  });
});
