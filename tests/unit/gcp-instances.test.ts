import { describe, expect, it, vi } from 'vitest';
import { instancesInRegion } from '@/lib/gcp/instances';
import { generateConnectionKey } from '@/lib/gcp/issuer';
import type { FederationTarget } from '@/lib/gcp/federation';

/**
 * Reading the instances of one region of a Google Cloud project.
 *
 * `aggregatedList` answers for the whole project, keyed by zone, so "one region" is something OpsWatch
 * does rather than something Google does for it. The three things worth breaking are the prefix match
 * (`us-central1` must not swallow `us-central12`), the paging (a first page shown as though it were
 * the whole project is worse than an error), and the figures that were never reported.
 */

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const KEY = generateConnectionKey();
const target: FederationTarget = { projectNumber: '123456789012', poolId: 'opswatch', providerId: 'opswatch', serviceAccount: null };

const sts = () => new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 });

const instance = (name: string, over: Record<string, unknown> = {}) => ({
  id: `id-${name}`,
  name,
  status: 'RUNNING',
  machineType: 'https://www.googleapis.com/compute/v1/projects/p/zones/us-central1-a/machineTypes/e2-medium',
  creationTimestamp: '2026-09-20T10:00:00.000-07:00',
  ...over,
});

function google(pages: Record<string, unknown>[]) {
  let page = 0;
  return vi.fn(async (url: string) => {
    if (url.startsWith('https://sts.')) return sts();
    const body = pages[Math.min(page, pages.length - 1)];
    page += 1;
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

const read = (call: ReturnType<typeof google> | ReturnType<typeof vi.fn>, region = 'us-central1') =>
  instancesInRegion({
    connectionId: 'c1',
    projectId: 'my-project',
    region,
    target,
    key: KEY,
    baseUrl: 'https://ops.example',
    nowMs: NOW,
    fetchImpl: call as unknown as typeof fetch,
  });

describe('which instances belong to the region', () => {
  it('THE RULING: a zone belongs to its region, and to no region that merely starts the same way', () => {
    // `us-central1` and `us-central12` are different regions. Matching on `startsWith(region)` without
    // the separator would put another region's machines on this region's page.
    const call = google([
      {
        items: {
          'zones/us-central1-a': { instances: [instance('here')] },
          'zones/us-central12-a': { instances: [instance('elsewhere')] },
          'zones/europe-west1-b': { instances: [instance('far')] },
          global: { warning: { code: 'NO_RESULTS_ON_PAGE' } },
        },
      },
    ]);
    return expect(read(call)).resolves.toEqual({
      ok: true,
      data: [expect.objectContaining({ name: 'here', zone: 'us-central1-a' })],
    });
  });

  it('THE RULING: it reads every page, because half a project shown as all of it is worse than an error', async () => {
    const call = google([
      { items: { 'zones/us-central1-a': { instances: [instance('first')] } }, nextPageToken: 'more' },
      { items: { 'zones/us-central1-b': { instances: [instance('second')] } } },
    ]);
    const result = await read(call);

    expect(result.ok && result.data.map((one) => one.name).sort()).toEqual(['first', 'second']);
    // Two list calls plus the one exchange.
    expect(call).toHaveBeenCalledTimes(3);
    expect((call.mock.calls[2] as unknown as [string])[0]).toContain('pageToken=more');
  });

  it('stops rather than following a project’s paging for ever', async () => {
    // Every page says there is another. A page render must not walk a hundred thousand instances.
    const endless = vi.fn(async (url: string) =>
      url.startsWith('https://sts.')
        ? sts()
        : new Response(JSON.stringify({ items: { 'zones/us-central1-a': { instances: [instance('x')] } }, nextPageToken: 'again' }), { status: 200 }),
    );
    await read(endless);
    // One exchange and the bounded number of pages, not one more.
    expect(endless).toHaveBeenCalledTimes(11);
  });
});

describe('what each instance says', () => {
  it('leaves Google’s own words alone, and says null where it reported nothing', async () => {
    const call = google([
      {
        items: {
          'zones/us-central1-a': {
            instances: [
              instance('stopped', { status: 'TERMINATED' }),
              // No machine type and no timestamp: unreported, which is not the same as empty or epoch.
              { id: 'id-bare', name: 'bare', status: 'RUNNING' },
            ],
          },
        },
      },
    ]);
    const result = await read(call);

    expect(result.ok && result.data.find((one) => one.name === 'stopped')?.status).toBe('TERMINATED');
    expect(result.ok && result.data.find((one) => one.name === 'bare')).toMatchObject({ machineType: null, createdAt: null });
    // The machine type is the last segment of the resource URL, not the URL.
    expect(result.ok && result.data.find((one) => one.name === 'stopped')?.machineType).toBe('e2-medium');
  });

  it('drops an entry with no id or name rather than showing a row about nothing', async () => {
    const call = google([{ items: { 'zones/us-central1-a': { instances: [{ status: 'RUNNING' }, instance('real')] } } }]);
    const result = await read(call);
    expect(result.ok && result.data.map((one) => one.name)).toEqual(['real']);
  });
});

describe('when it cannot be read', () => {
  it('tells a refused role from an unreachable instance from a broken API', async () => {
    const denied = vi.fn(async (url: string) => (url.startsWith('https://sts.') ? sts() : new Response('{}', { status: 403 })));
    await expect(read(denied)).resolves.toEqual({ ok: false, reason: 'denied' });

    const broken = vi.fn(async (url: string) => (url.startsWith('https://sts.') ? sts() : new Response('{}', { status: 500 })));
    await expect(read(broken)).resolves.toEqual({ ok: false, reason: 'error' });

    const dead = vi.fn(async (url: string) => {
      if (url.startsWith('https://sts.')) return sts();
      throw new Error('ECONNREFUSED');
    });
    await expect(read(dead)).resolves.toEqual({ ok: false, reason: 'unreachable' });
  });

  it('says there is no token rather than pretending the project is empty', async () => {
    const refused = vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));
    await expect(read(refused)).resolves.toMatchObject({ ok: false, reason: 'no_token' });
  });
});
