import { describe, expect, it, vi } from 'vitest';
import { generateConnectionKey } from '@/lib/gcp/issuer';
import { ALIGNMENT_SECONDS, CPU_METRIC, cpuFilter, instanceCpuSeries, latestOf } from '@/lib/gcp/metrics';
import type { GcpTarget } from '@/lib/gcp/target';

/**
 * Agentless CPU utilisation from Cloud Monitoring.
 *
 * Three things worth breaking. The **filter** is a query language built by string concatenation, and an
 * id that came from an API is still an id that goes into a query. The **value** is a fraction of one,
 * not a percentage, and the difference between those two readings of 0.42 is a factor of a hundred.
 * And an instance that reported **nothing** must stay nothing: a stopped machine drawn as 0 % is a flat
 * green line under something that is switched off, which is the one failure this product calls a defect.
 */

const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);
const KEY = generateConnectionKey();

const target: GcpTarget = {
  provider: 'gcp',
  connectionId: 'c1',
  projectId: 'my-project',
  region: 'us-central1',
  federation: { projectNumber: '123456789012', poolId: 'opswatch', providerId: 'opswatch', serviceAccount: null },
  key: KEY,
  baseUrl: 'https://opswatch.example',
};

const sts = () => new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 });

const series = (instanceId: string, points: { endTime: string; doubleValue: number | null }[]) => ({
  resource: { type: 'gce_instance', labels: { instance_id: instanceId, zone: 'us-central1-a' } },
  points: points.map((point) => ({
    interval: { startTime: point.endTime, endTime: point.endTime },
    value: point.doubleValue === null ? {} : { doubleValue: point.doubleValue },
  })),
});

function monitoring(bodies: Record<string, unknown>[], status = 200) {
  const urls: string[] = [];
  let page = 0;
  const call = vi.fn(async (url: string) => {
    if (url.startsWith('https://sts.')) return sts();
    urls.push(url);
    if (status !== 200) return new Response('{}', { status });
    const body = bodies[Math.min(page, bodies.length - 1)];
    page += 1;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return { call, urls };
}

const read = (call: ReturnType<typeof vi.fn>, instanceIds: string[] = ['100', '200']) =>
  instanceCpuSeries({
    target,
    instanceIds,
    startMs: NOW - 15 * 60_000,
    endMs: NOW,
    nowMs: NOW,
    fetchImpl: call as unknown as typeof fetch,
  });

describe('the filter Google is sent', () => {
  it('THE RULING: an id that is not an id never reaches the filter', () => {
    /*
     * Ids come from Compute Engine's own answer, which is not a reason to skip checking: this string
     * is concatenated into a query language, and a quote in it would end the literal and start
     * something else. Google's ids are decimal integers, and only those go in.
     */
    const hostile = '1" OR resource.labels.instance_id = "999';
    const filter = cpuFilter(['100', hostile, '', 'abc']);
    expect(filter).not.toContain('OR');
    expect(filter).not.toContain('abc');
    expect(filter).toContain('one_of("100")');
  });

  it('selects exactly one metric type, which the API requires', () => {
    // `timeSeries.list` refuses a filter that does not name exactly one. Two would be a 400 on a page.
    const filter = cpuFilter([]);
    expect(filter.match(/metric\.type/g)).toHaveLength(1);
    expect(filter).toContain(`metric.type = "${CPU_METRIC}"`);
    // Upper case, because Google's filter grammar requires it.
    expect(filter).toContain(' AND ');
    expect(filter).toContain('resource.type = "gce_instance"');
  });

  it('drops the id list rather than sending more than one_of accepts', () => {
    // `one_of` takes up to 100. Past that the whole project is read and narrowed here — one request
    // either way, and the narrowing that matters happens where it cannot be got wrong.
    const many = Array.from({ length: 101 }, (_, index) => String(index + 1));
    expect(cpuFilter(many)).not.toContain('one_of');
    expect(cpuFilter(many.slice(0, 100))).toContain('one_of');
  });

  it('asks for the points, the mean aligner and Google’s own sampling period', async () => {
    const { call, urls } = monitoring([{ timeSeries: [] }]);
    await read(call);
    const url = new URL(urls[0]);
    expect(url.origin + url.pathname).toBe('https://monitoring.googleapis.com/v3/projects/my-project/timeSeries');
    expect(url.searchParams.get('aggregation.perSeriesAligner')).toBe('ALIGN_MEAN');
    expect(url.searchParams.get('aggregation.alignmentPeriod')).toBe(`${ALIGNMENT_SECONDS}s`);
    // HEADERS would answer without any points in it, which would read as an instance reporting nothing.
    expect(url.searchParams.get('view')).toBe('FULL');
    // RFC 3339, to the second: Google rejects a bare epoch.
    expect(url.searchParams.get('interval.endTime')).toBe('2026-09-28T12:00:00Z');
    expect(url.searchParams.get('interval.startTime')).toBe('2026-09-28T11:45:00Z');
  });
});

describe('what comes back', () => {
  it('THE RULING: an instance that reported nothing stays nothing, never zero', async () => {
    const { call } = monitoring([{ timeSeries: [series('100', [{ endTime: '2026-09-28T11:59:00Z', doubleValue: 0.42 }])] }]);
    const result = await read(call);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 200 was asked for and Google said nothing about it — because it is stopped, most likely.
    expect(result.data.map((entry) => entry.instanceId)).toEqual(['100']);
    expect(latestOf(result.data.find((entry) => entry.instanceId === '200'))).toBeNull();
    // And the one that did report is carried as the fraction Google sent, not multiplied on the way in.
    expect(latestOf(result.data[0])).toBe(0.42);
  });

  it('drops a point with no number in it rather than reading it as zero', async () => {
    const { call } = monitoring([
      {
        timeSeries: [
          series('100', [
            { endTime: '2026-09-28T11:58:00Z', doubleValue: 0.1 },
            { endTime: '2026-09-28T11:59:00Z', doubleValue: null },
          ]),
        ],
      },
    ]);
    const result = await read(call);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0].points).toEqual([{ at: Date.parse('2026-09-28T11:58:00Z'), value: 0.1 }]);
  });

  it('returns points oldest first, so a sparkline reads left to right', async () => {
    const { call } = monitoring([
      {
        timeSeries: [
          series('100', [
            { endTime: '2026-09-28T11:59:00Z', doubleValue: 0.3 },
            { endTime: '2026-09-28T11:57:00Z', doubleValue: 0.1 },
            { endTime: '2026-09-28T11:58:00Z', doubleValue: 0.2 },
          ]),
        ],
      },
    ]);
    const result = await read(call);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0].points.map((point) => point.value)).toEqual([0.1, 0.2, 0.3]);
    expect(latestOf(result.data[0])).toBe(0.3);
  });

  it('ignores a series for an instance nobody asked about', async () => {
    // The filter is a request. The answer is not trusted to have honoured it.
    const { call } = monitoring([{ timeSeries: [series('999', [{ endTime: '2026-09-28T11:59:00Z', doubleValue: 0.9 }])] }]);
    const result = await read(call, ['100']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([]);
  });

  it('follows pages, and says so when it stops before the end', async () => {
    const page = (id: string, token?: string) => ({
      timeSeries: [series(id, [{ endTime: '2026-09-28T11:59:00Z', doubleValue: 0.5 }])],
      ...(token === undefined ? {} : { nextPageToken: token }),
    });
    const { call } = monitoring([page('100', 'a'), page('200')]);
    const result = await read(call);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((entry) => entry.instanceId).sort()).toEqual(['100', '200']);
    expect(result.truncated).toBe(false);

    // A project that keeps paging is truncated rather than quietly shown as complete.
    const endless = monitoring([page('100', 'more')]);
    const long = await read(endless.call, ['100']);
    expect(long.ok && long.truncated).toBe(true);
  });
});

describe('when Google refuses', () => {
  it('says which refusal, in terms of the grant that is missing', async () => {
    // 403 is the one an operator can act on: `roles/monitoring.viewer` has not reached this connection,
    // which is a different grant from the `roles/compute.viewer` that listed the instances.
    for (const [status, reason] of [
      [401, 'denied'],
      [403, 'denied'],
      [500, 'error'],
    ] as const) {
      const { call } = monitoring([{}], status);
      await expect(read(call), String(status)).resolves.toMatchObject({ ok: false, reason });
    }
  });

  it('is unreachable rather than empty when the request cannot be made', async () => {
    // An empty list here would read as a project where every instance is idle.
    const dead = vi.fn(async (url: string) => {
      if (url.startsWith('https://sts.')) return sts();
      throw new Error('ECONNREFUSED');
    });
    await expect(read(dead as unknown as ReturnType<typeof vi.fn>)).resolves.toMatchObject({ ok: false, reason: 'unreachable' });
  });
});
