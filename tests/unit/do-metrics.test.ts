import { describe, expect, it, vi } from 'vitest';
import {
  BANDWIDTH_DROPLET_CAP,
  DO_AGENTLESS_METRICS,
  DO_AGENT_METRICS,
  dropletBandwidth,
  latestBandwidth,
} from '@/lib/do/metrics';
import type { DoTarget } from '@/lib/do/target';

/**
 * Agentless droplet metrics.
 *
 * The fact this file exists to hold on to: **what DigitalOcean measures without an agent is not what
 * Google measures without one, and it is close to the opposite.** DigitalOcean gives bandwidth, disk
 * I/O and disk usage from outside the droplet and needs `do-agent` for CPU, load and memory; Google
 * gives CPU from the hypervisor and needs the Ops Agent for memory. An earlier version of this
 * codebase's notes had DigitalOcean's list backwards — plausible, consistent, and wrong — which is
 * why the split is a test and not a comment.
 */

const target: DoTarget = { provider: 'do', connectionId: 'c1', token: 'dop_v1_token' };
const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);

const point = (seconds: number, value: string): [number, string] => [seconds, value];

function api(byDirection: Record<string, unknown>, status = 200) {
  const urls: string[] = [];
  const call = vi.fn(async (url: string) => {
    urls.push(url);
    if (status !== 200) return new Response('{}', { status });
    const direction = new URL(url).searchParams.get('direction') ?? '';
    return new Response(JSON.stringify(byDirection[direction] ?? { data: { result: [] } }), { status: 200 });
  });
  return { call, urls };
}

const series = (values: [number, string][]) => ({ data: { result: [{ metric: { interface: 'public' }, values }] } });

const read = (call: ReturnType<typeof vi.fn>, dropletIds: number[] = [101]) =>
  dropletBandwidth({
    target,
    dropletIds,
    startMs: NOW - 15 * 60_000,
    endMs: NOW,
    fetchImpl: call as unknown as typeof fetch,
  });

describe('what DigitalOcean measures without an agent', () => {
  it('THE RULING: CPU is not on the agentless list, because on this cloud it is not agentless', () => {
    /*
     * CPU is the first metric anyone reaches for and the one this product must not show for
     * DigitalOcean as though it were free. It comes from `do-agent`, inside the droplet. Claiming it
     * here would be inventing parity DigitalOcean does not offer — and would read as OpsWatch failing
     * to measure something, on every droplet without the agent.
     */
    expect([...DO_AGENT_METRICS]).toContain('cpu');
    expect([...DO_AGENTLESS_METRICS]).not.toContain('cpu');
    // And the two lists never overlap: a metric cannot be both.
    for (const metric of DO_AGENT_METRICS) expect([...DO_AGENTLESS_METRICS], metric).not.toContain(metric);
  });

  it('names memory and load average as the agent’s too, and bandwidth as ours', () => {
    expect([...DO_AGENT_METRICS].sort()).toEqual(['cpu', 'load_average', 'memory']);
    expect([...DO_AGENTLESS_METRICS]).toContain('bandwidth');
  });
});

describe('reading public bandwidth', () => {
  it('asks for each direction of the public interface, in Unix seconds', async () => {
    const { call, urls } = api({});
    await read(call);
    expect(urls).toHaveLength(2);
    const asked = urls.map((url) => new URL(url));
    expect(asked[0].pathname).toBe('/v2/monitoring/metrics/droplet/bandwidth');
    expect(asked.map((url) => url.searchParams.get('direction')).sort()).toEqual(['inbound', 'outbound']);
    // Public only: a private interface exists on some droplets and not others, and a blank column on
    // the ones without it would read as "no traffic" rather than "no private network".
    expect(asked[0].searchParams.get('interface')).toBe('public');
    expect(asked[0].searchParams.get('host_id')).toBe('101');
    // Seconds, not milliseconds — a thousand-fold error that would ask for a window in 1970.
    expect(asked[0].searchParams.get('end')).toBe(String(Math.floor(NOW / 1000)));
  });

  it('THE RULING: a figure DigitalOcean did not send is not zero', async () => {
    /*
     * The values arrive as strings, and `Number('')` is 0. A droplet whose sample was blank, shown at
     * 0 Mbps, is a silent machine and a machine nobody measured made to look identical — §2.4.
     */
    const { call } = api({
      inbound: series([point(NOW / 1000 - 60, ''), point(NOW / 1000, '1.5')]),
      outbound: series([point(NOW / 1000 - 60, '0.25')]),
    });
    const result = await read(call);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const entry = result.data[0];
    // The blank inbound sample is absent, not zero; the outbound one at that time is kept.
    expect(entry.points[0]).toEqual({ at: NOW - 60_000, inbound: null, outbound: 0.25 });
    // And at the later time only inbound reported, so outbound is null rather than 0.
    expect(entry.points[1]).toEqual({ at: NOW, inbound: 1.5, outbound: null });
    expect(latestBandwidth(entry, 'inbound')).toBe(1.5);
    // The latest *measured* outbound, not the latest point — which has none.
    expect(latestBandwidth(entry, 'outbound')).toBe(0.25);
  });

  it('answers null for a droplet that reported nothing at all', async () => {
    const { call } = api({});
    const result = await read(call);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(latestBandwidth(result.data[0], 'inbound')).toBeNull();
    expect(latestBandwidth(undefined, 'inbound')).toBeNull();
  });

  it('THE RULING: it caps the droplets it reads, and says when it did', async () => {
    // Two requests per droplet against a 250-a-minute limit: an account of a hundred droplets must not
    // turn one page render into two hundred calls, and must not show the first twelve as though they
    // were all of them.
    const ids = Array.from({ length: BANDWIDTH_DROPLET_CAP + 3 }, (_, index) => index + 1);
    const { call, urls } = api({});
    const result = await read(call, ids);
    expect(urls).toHaveLength(BANDWIDTH_DROPLET_CAP * 2);
    expect(result.ok && result.truncated).toBe(true);

    const few = api({});
    const small = await read(few.call, [1, 2]);
    expect(small.ok && small.truncated).toBe(false);
  });

  it('reports a refusal for the page rather than eleven figures and one blank', async () => {
    // A token allowed to read droplets and not metrics is a real state; it is a property of the
    // token, not of one droplet, and saying so once is what tells an operator what to fix.
    for (const [status, reason] of [
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [429, 'rate_limited'],
      [500, 'error'],
    ] as const) {
      const { call } = api({}, status);
      await expect(read(call, [1, 2]), String(status)).resolves.toEqual({ ok: false, reason });
    }
  });

  it('is unreachable rather than empty when the request cannot be made', async () => {
    const dead = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(read(dead as unknown as ReturnType<typeof vi.fn>)).resolves.toEqual({ ok: false, reason: 'unreachable' });
  });

  it('ignores a droplet id that is not one', async () => {
    const { call, urls } = api({});
    await read(call, [0, -1, 1.5, 101]);
    expect(urls).toHaveLength(2);
    expect(new URL(urls[0]).searchParams.get('host_id')).toBe('101');
  });
});
