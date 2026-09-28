import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { DO_ALERTS_NEED_AGENT, listAlertPolicies } from '@/lib/do/alerts';
import { capabilitiesOf } from '@/lib/monitoring/capabilities';
import type { DoTarget } from '@/lib/do/target';

/**
 * What an operator asked DigitalOcean to tell them about.
 *
 * **DigitalOcean exposes alert policies and never which of them are firing.** Its Monitoring API has
 * five operations on policies and sixty metric endpoints, and no endpoint for open incidents. Google
 * has `projects.alerts`, which is why a Google project has incidents in this product and a
 * DigitalOcean account has none — not because OpsWatch has not got round to it.
 *
 * That asymmetry is the thing to protect. The pressure, when three clouds sit beside each other in
 * one product, is to make the third look like the first two; the mission's word for giving in to it
 * is inventing parity DigitalOcean does not provide.
 */

const target: DoTarget = { provider: 'do', connectionId: 'c1', token: 'dop_v1_token' };

const policy = (over: Record<string, unknown> = {}) => ({
  uuid: '78b3da62-27e5-49ba-ac70-5db0b5935c64',
  type: 'v1/insights/droplet/cpu',
  description: 'CPU above 80%',
  compare: 'GreaterThan',
  value: 80,
  window: '5m',
  entities: ['192018292'],
  tags: [],
  enabled: true,
  ...over,
});

function api(policies: unknown[], status = 200) {
  const urls: string[] = [];
  const call = vi.fn(async (url: string) => {
    urls.push(url);
    if (status !== 200) return new Response('{}', { status });
    return new Response(JSON.stringify({ policies }), { status: 200 });
  });
  return { call, urls };
}

const read = (call: ReturnType<typeof vi.fn>) => listAlertPolicies({ target, fetchImpl: call as unknown as typeof fetch });

describe('what DigitalOcean can and cannot tell us', () => {
  it('THE RULING: OpsWatch does not claim DigitalOcean reports open incidents', () => {
    /*
     * `alerts` means something different on each cloud, and the capability table is where that is
     * declared. It is `supported` here because the policies are readable — and the product must never
     * turn that into a claim that their firing state is.
     */
    expect(capabilitiesOf('do').alerts.state).toBe('supported');
    // Health and problems are not claimed from it: DigitalOcean gives no verdict to relay.
    expect(capabilitiesOf('do').health.state).not.toBe('supported');
    expect(capabilitiesOf('do').problems.state).not.toBe('supported');
    // Google is the contrast, and it is a real one: there, an open incident is a verdict to relay.
    expect(capabilitiesOf('gcp').problems.state).toBe('supported');
  });

  it('THE RULING: it does not guess a per-metric agent split for alert policies', () => {
    /*
     * An earlier version of this file decided per metric which policies need `do-agent`, reasoning
     * from what a hypervisor can see. DigitalOcean's own words about creating a policy are: "Only
     * Droplets with the DigitalOcean metrics agent installed are available to select." All twelve
     * metrics, bandwidth included. The guess was the wrong shape as well as the wrong answer, and an
     * operator reading "Enabled" on a droplet without the agent is not covered by anything.
     */
    expect(DO_ALERTS_NEED_AGENT).toBe(true);
    const source = readFileSync(new URL('../../src/lib/do/alerts.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('needsAgentFor');
  });

  it('THE RULING: it does not claim disk usage is measured from outside the droplet', async () => {
    /*
     * The other half of the same correction. A hypervisor can count a guest's packets and its
     * block-device operations; how full a filesystem *inside* that guest is, it cannot see. A graphs
     * page listing "Disk Usage" as a default chart is not enough to assert it, so the claim is
     * limited to what is established rather than made either way.
     */
    const { DO_AGENTLESS_METRICS } = await import('@/lib/do/metrics');
    expect([...DO_AGENTLESS_METRICS]).toEqual(['bandwidth', 'disk_io']);
  });
});

describe('reading the policies', () => {
  it('THE RULING: a threshold DigitalOcean did not send is unknown, never zero', async () => {
    // "Above 0 %" is a different policy from one whose threshold nobody could read, and the first
    // would look to an operator like an alert that fires constantly.
    const { call } = api([policy({ value: undefined, compare: undefined })]);
    const result = await read(call);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.policies[0]).toMatchObject({ value: null, compare: null });
  });

  it('counts a policy with no `enabled` field as off, not on', async () => {
    // Read as truthy, `undefined` would count a policy as watching something. Off is the safe reading
    // because it under-claims coverage rather than over-claiming it.
    const { call } = api([policy({ enabled: undefined }), policy({ uuid: 'b', enabled: false }), policy({ uuid: 'c' })]);
    const result = await read(call);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.policies.filter((entry) => entry.enabled)).toHaveLength(1);
  });

  it('puts the ones that can fire first', async () => {
    const { call } = api([policy({ uuid: 'off', description: 'AAA', enabled: false }), policy({ uuid: 'on', description: 'ZZZ' })]);
    const result = await read(call);
    expect(result.ok && result.policies.map((entry) => entry.uuid)).toEqual(['on', 'off']);
  });

  it('constructs the page number rather than following a link out of the body', async () => {
    // The same rule the droplet list follows: a URL taken from a response is a request this code can
    // be talked into making.
    const { call, urls } = api([]);
    await read(call);
    expect(urls[0]).toContain('https://api.digitalocean.com/v2/monitoring/alerts?page=1');
  });

  it('says which refusal it was, and never an empty list', async () => {
    // An empty list would read as "you have configured nothing", which is a different and alarming
    // statement from "this token may not read your policies".
    for (const [status, reason] of [
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [429, 'rate_limited'],
      [500, 'error'],
    ] as const) {
      const { call } = api([], status);
      await expect(read(call), String(status)).resolves.toEqual({ ok: false, reason });
    }
  });
});
