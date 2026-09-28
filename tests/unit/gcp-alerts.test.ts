import { describe, expect, it, vi } from 'vitest';
import { projectAlerts, quietMeansSomething } from '@/lib/gcp/alerts';
import { generateConnectionKey } from '@/lib/gcp/issuer';
import type { GcpTarget } from '@/lib/gcp/target';

/**
 * What Google is complaining about, and whether anybody asked it to.
 *
 * The thing this file exists to hold: **an empty incident list is not a verdict.** A project with no
 * open incidents and no enabled alerting policies has not been found healthy — nothing was watching.
 * Showing those two states the same way is the most comfortable lie a monitoring tool can tell, and
 * the mission's words for it are "do not manufacture health conclusions when the provider does not
 * expose enough information".
 */

const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);
const target: GcpTarget = {
  provider: 'gcp',
  connectionId: 'c1',
  projectId: 'my-project',
  region: 'us-central1',
  federation: { projectNumber: '123456789012', poolId: 'opswatch', providerId: 'opswatch', serviceAccount: null },
  key: generateConnectionKey(),
  baseUrl: 'https://opswatch.example',
};

const sts = () => new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 });

const alert = (over: Record<string, unknown> = {}) => ({
  name: 'projects/my-project/alerts/0.abcdef',
  state: 'OPEN',
  openTime: '2026-09-28T11:30:00Z',
  resource: { type: 'gce_instance', labels: { instance_id: '100', instance_name: 'web-1' } },
  policy: { displayName: 'CPU above 90%', severity: 'CRITICAL' },
  ...over,
});

function google(alerts: unknown[], policies: unknown[], status = 200) {
  const urls: string[] = [];
  const call = vi.fn(async (url: string) => {
    if (url.startsWith('https://sts.')) return sts();
    urls.push(url);
    if (status !== 200) return new Response('{}', { status });
    const body = url.includes('/alertPolicies') ? { alertPolicies: policies } : { alerts };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return { call, urls };
}

const read = (call: ReturnType<typeof vi.fn>) =>
  projectAlerts({ target, nowMs: NOW, fetchImpl: call as unknown as typeof fetch });

describe('quiet, and what it is worth', () => {
  it('THE RULING: no incidents and nothing watching is not a healthy project', () => {
    // The whole point. `quietMeansSomething` is what the page branches on, and it is false exactly
    // when nothing could have raised an incident in the first place.
    expect(quietMeansSomething({ total: 0, enabled: 0, truncated: false })).toBe(false);
    // Policies that exist but are switched off cannot open an incident either.
    expect(quietMeansSomething({ total: 7, enabled: 0, truncated: false })).toBe(false);
    // One enabled policy is enough for silence to be Google asserting something.
    expect(quietMeansSomething({ total: 7, enabled: 1, truncated: false })).toBe(true);
  });

  it('counts enabled policies whichever way Google wrapped the flag', async () => {
    /*
     * `enabled` comes back as a bare boolean or as `{ value }` depending on how the policy was
     * written. Read as truthy, `{ value: false }` counts a switched-off policy as watching — which
     * turns "nothing is watching" into "nothing is wrong", the exact failure above.
     */
    const { call } = google([], [{ enabled: true }, { enabled: { value: true } }, { enabled: { value: false } }, { enabled: false }, {}]);
    const result = await read(call);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.policies).toMatchObject({ total: 5, enabled: 2 });
  });
});

describe('open incidents', () => {
  it('shows only what is open, because this page is about now', async () => {
    // A closed incident among the open ones is an operator chasing something that already ended.
    const { call } = google(
      [alert(), alert({ name: 'projects/p/alerts/closed', state: 'CLOSED' }), alert({ name: 'projects/p/alerts/x', state: 'STATE_UNSPECIFIED' })],
      [{ enabled: true }],
    );
    const result = await read(call);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.incidents).toHaveLength(1);
    expect(result.incidents[0].id).toBe('0.abcdef');
  });

  it('carries Google’s own policy name and severity, and invents neither', async () => {
    const { call } = google([alert(), alert({ name: 'projects/p/alerts/two', policy: {} })], [{ enabled: true }]);
    const result = await read(call);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.incidents[0]).toMatchObject({ policy: 'CPU above 90%', severity: 'CRITICAL', resourceName: 'web-1', resourceType: 'gce_instance' });
    // A policy with no severity is not a low-severity policy. Null, and the page says so in words.
    expect(result.incidents[1].severity).toBeNull();
    expect(result.incidents[1].policy).toBe('');
  });

  it('names the resource from whichever label Google used, and null when there is none', async () => {
    const { call } = google(
      [
        alert({ resource: { type: 'cloud_run_revision', labels: { service_name: 'checkout' } } }),
        alert({ name: 'projects/p/alerts/b', resource: { type: 'global', labels: {} } }),
      ],
      [{ enabled: true }],
    );
    const result = await read(call);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.incidents[0].resourceName).toBe('checkout');
    // Not the empty string, and not the type pretending to be a name.
    expect(result.incidents[1].resourceName).toBeNull();
    expect(result.incidents[1].resourceType).toBe('global');
  });

  it('asks for open incidents newest first, from the project', async () => {
    const { call, urls } = google([], []);
    await read(call);
    const incidents = new URL(urls.find((url) => url.includes('/alerts')) as string);
    expect(incidents.pathname).toBe('/v3/projects/my-project/alerts');
    expect(incidents.searchParams.get('orderBy')).toBe('openTime desc');
    // And the policies, which are a separate call to a separate resource.
    expect(urls.some((url) => url.includes('/alertPolicies'))).toBe(true);
  });

  it('drops an incident with no id rather than keying a row on nothing', async () => {
    const { call } = google([alert({ name: undefined }), alert()], [{ enabled: true }]);
    const result = await read(call);
    expect(result.ok && result.incidents).toHaveLength(1);
  });
});

describe('when Google refuses', () => {
  it('says which refusal, and never an empty list', async () => {
    // An empty list here would be the worst possible answer: a project reported as quiet because the
    // read was refused.
    for (const [status, reason] of [
      [401, 'denied'],
      [403, 'denied'],
      [500, 'error'],
    ] as const) {
      const { call } = google([], [], status);
      await expect(read(call), String(status)).resolves.toMatchObject({ ok: false, reason });
    }
  });

  it('is unreachable rather than quiet when the request cannot be made', async () => {
    const dead = vi.fn(async (url: string) => {
      if (url.startsWith('https://sts.')) return sts();
      throw new Error('ECONNREFUSED');
    });
    await expect(read(dead as unknown as ReturnType<typeof vi.fn>)).resolves.toMatchObject({ ok: false, reason: 'unreachable' });
  });
});
