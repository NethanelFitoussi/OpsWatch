import { describe, expect, it, vi } from 'vitest';
import { listDroplets } from '@/lib/do/droplets';
import { testDoConnection } from '@/lib/do/check';

/**
 * Reading a DigitalOcean account.
 *
 * The thing most worth breaking here is not a threshold, it is a habit: DigitalOcean's responses carry
 * `links.pages.next` as a full URL, and fetching a URL out of a response body is a request this code
 * can be talked into making. The page number is ours.
 */

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const TOKEN = 'dop_v1_'.padEnd(64, 'a');

const droplet = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  name: `web-${id}`,
  status: 'active',
  memory: 2048,
  vcpus: 2,
  created_at: '2026-09-20T10:00:00Z',
  region: { slug: 'lon1' },
  size_slug: 's-2vcpu-2gb',
  ...over,
});

const page = (droplets: unknown[], next?: string) =>
  new Response(JSON.stringify({ droplets, links: next === undefined ? {} : { pages: { next } } }), { status: 200 });

describe('listing droplets', () => {
  it('THE RULING: it never follows a URL out of the response body', async () => {
    /*
     * `links.pages.next` is attacker-influenced in the general case — a compromised endpoint, a proxy,
     * anything in between — and following it is an outbound request chosen by somebody else. The page
     * number is constructed here and the host is a constant.
     */
    const call = vi.fn(async () =>
      page([droplet(1)], 'https://evil.example/v2/droplets?page=2'),
    );
    await listDroplets({ token: TOKEN, fetchImpl: call as unknown as typeof fetch });

    const urls = call.mock.calls.map((args) => (args as unknown as string[])[0]);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url.startsWith('https://api.digitalocean.com/v2/')).toBe(true);
    expect(urls.join()).not.toContain('evil.example');
  });

  it('THE RULING: it reads every page, because a partial account shown as a whole one looks fine', async () => {
    const first = Array.from({ length: 200 }, (_, index) => droplet(index + 1));
    const call = vi.fn(async (url: string) => (url.includes('page=1') ? page(first) : page([droplet(999)])));
    // A full page means there may be another; a short one is the end.
    const full = vi.fn(async (url: string) => (url.includes('page=1') ? page(first, 'x') : page([droplet(999)])));

    const result = await listDroplets({ token: TOKEN, fetchImpl: full as unknown as typeof fetch });
    expect(result.ok && result.data).toHaveLength(201);
    expect(full).toHaveBeenCalledTimes(2);
    expect((full.mock.calls[1] as unknown as [string])[0]).toContain('page=2');

    // A first page that is not full is the only page, and asking again would be a wasted call.
    const short = vi.fn(async () => page([droplet(1)]));
    await listDroplets({ token: TOKEN, fetchImpl: short as unknown as typeof fetch });
    expect(short).toHaveBeenCalledTimes(1);
    expect(call).not.toHaveBeenCalled();
  });

  it('stops rather than walking an account without end', async () => {
    const endless = vi.fn(async () => page(Array.from({ length: 200 }, (_, index) => droplet(index + 1))));
    await listDroplets({ token: TOKEN, fetchImpl: endless as unknown as typeof fetch });
    expect(endless).toHaveBeenCalledTimes(10);
  });

  it('tells a rejected token from one that is not allowed to read droplets', async () => {
    const cases: [number, string][] = [
      [401, 'unauthorized'],
      // A token that authenticates and is refused is a scope problem, and the fix is a different one.
      [403, 'forbidden'],
      [429, 'rate_limited'],
      [500, 'error'],
    ];
    for (const [status, reason] of cases) {
      const call = vi.fn(async () => new Response('{}', { status }));
      await expect(listDroplets({ token: TOKEN, fetchImpl: call as unknown as typeof fetch }), String(status)).resolves.toEqual({ ok: false, reason });
    }

    const dead = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(listDroplets({ token: TOKEN, fetchImpl: dead as unknown as typeof fetch })).resolves.toEqual({ ok: false, reason: 'unreachable' });
  });

  it('asks for nothing when there is no token, rather than calling with none', async () => {
    const call = vi.fn();
    await expect(listDroplets({ token: null, fetchImpl: call as unknown as typeof fetch })).resolves.toEqual({ ok: false, reason: 'no_token' });
    expect(call).not.toHaveBeenCalled();
  });

  it('says null for a figure DigitalOcean did not send, and keeps its own words', async () => {
    const call = vi.fn(async () => page([droplet(1, { status: 'off', memory: undefined, region: undefined, size_slug: undefined, created_at: undefined })]));
    const result = await listDroplets({ token: TOKEN, fetchImpl: call as unknown as typeof fetch });

    expect(result.ok && result.data[0]).toMatchObject({ status: 'off', memoryMb: null, region: null, size: null, createdAt: null });
  });
});

describe('what the check writes down', () => {
  it('THE RULING: a failed read leaves the count unknown, never zero', async () => {
    const refused = vi.fn(async () => new Response('{}', { status: 403 }));
    await expect(testDoConnection({ token: TOKEN, nowMs: NOW, fetchImpl: refused as unknown as typeof fetch })).resolves.toEqual({
      testedAt: NOW,
      failure: 'forbidden',
      // Zero would be a claim about an account OpsWatch could not read.
      droplets: null,
    });
  });

  it('counts, and keeps no inventory', async () => {
    const call = vi.fn(async () => page([droplet(1), droplet(2)]));
    const result = await testDoConnection({ token: TOKEN, nowMs: NOW, fetchImpl: call as unknown as typeof fetch });

    expect(result).toEqual({ testedAt: NOW, failure: null, droplets: 2 });
    // The row this is stored in must not become a copy of somebody's estate.
    expect(JSON.stringify(result)).not.toContain('web-1');
  });
});
