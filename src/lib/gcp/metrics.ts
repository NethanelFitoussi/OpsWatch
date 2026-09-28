import 'server-only';
import { accessTokenFor } from './federation';
import type { GcpTarget } from './target';

/**
 * Agentless CPU utilisation for the instances of one Google Cloud project.
 *
 * **Agentless is the whole point.** `compute.googleapis.com/instance/cpu/utilization` is written by
 * the hypervisor, so it is there for every running instance with nothing installed in it — which is
 * what makes a Google project readable by a self-hosted OpsWatch with no forwarder, no agent and no
 * account with us. Memory, disk space and process counts are **not** agentless on Google: they come
 * from `agent.googleapis.com/…`, which exists only where the Ops Agent is installed. This module does
 * not read them, and the page says so rather than showing an empty column.
 *
 * Verified against the current reference rather than written from memory:
 *
 *   - `GET https://monitoring.googleapis.com/v3/{name}/timeSeries`, `name` = `projects/<id>`
 *   - `filter` must select **exactly one** metric type; `AND` is upper case; strings are double-quoted
 *   - `interval.startTime` / `interval.endTime` are RFC 3339
 *   - `aggregation.alignmentPeriod` is a duration ending in `s`; `ALIGN_MEAN` is the mean aligner
 *   - the OAuth scope is `https://www.googleapis.com/auth/monitoring.read`, inside `cloud-platform`,
 *     which `roles/monitoring.viewer` grants — the role the connection wizard already asks for
 *
 * The metric is a GAUGE of DOUBLE in the range 0.0–1.0 — **a fraction, not a percentage.** Multiplying
 * it at the last moment, once, is deliberate: a 0.42 shown as 0.42 % and a 0.42 shown as 42 % differ
 * by a factor of a hundred and only one of them is a reason to wake somebody.
 */

const API = 'https://monitoring.googleapis.com/v3';
export const CPU_METRIC = 'compute.googleapis.com/instance/cpu/utilization';
/** Google's own sampling period for this metric. Aligning tighter invents points it did not send. */
export const ALIGNMENT_SECONDS = 60;
const MAX_PAGES = 5;
/** One series per instance; a project larger than this is truncated rather than walked in a render. */
const PAGE_SIZE = 500;

export type CpuSeries = {
  instanceId: string;
  /** Oldest first. `value` is a fraction of one vCPU-second per second, exactly as Google sent it. */
  points: { at: number; value: number }[];
};

export type GcpMetricsFailure = 'denied' | 'unreachable' | 'no_token' | 'error';
export type GcpMetricsResult =
  | { ok: true; data: CpuSeries[]; truncated: boolean }
  | { ok: false; reason: GcpMetricsFailure; detail?: string };

/**
 * A Google instance id, for use inside a filter expression.
 *
 * Ids come from Compute Engine's own answer, but they are put into a query language by string
 * concatenation, and "it came from an API we called" is not a reason to skip checking. Google's ids
 * are decimal integers; anything else does not go into the filter.
 */
const isInstanceId = (id: string): boolean => /^[0-9]{1,24}$/.test(id);

/** RFC 3339, to the second. Google rejects a bare epoch. */
const rfc3339 = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

export function cpuFilter(instanceIds: readonly string[]): string {
  const base = `metric.type = "${CPU_METRIC}" AND resource.type = "gce_instance"`;
  const ids = instanceIds.filter(isInstanceId);
  if (ids.length === 0) return base;
  // `one_of` takes up to 100 strings. Past that the whole project is fetched and filtered here, which
  // is one request either way — the filter is an optimisation, never what makes the answer correct.
  if (ids.length > 100) return base;
  return `${base} AND resource.labels.instance_id = one_of(${ids.map((id) => `"${id}"`).join(',')})`;
}

type RawPoint = { interval?: { endTime?: string }; value?: { doubleValue?: number } };
type RawSeries = { resource?: { labels?: Record<string, string> }; points?: RawPoint[] };

/**
 * CPU utilisation over `[startMs, endMs)`, one series per instance that reported any.
 *
 * An instance missing from the answer is **missing**, not idle: a stopped instance reports nothing,
 * and returning zero for it would put a flat green line under a machine that is switched off.
 */
export async function instanceCpuSeries(input: {
  target: GcpTarget;
  instanceIds: readonly string[];
  startMs: number;
  endMs: number;
  nowMs: number;
  alignmentSeconds?: number;
  fetchImpl?: typeof fetch;
}): Promise<GcpMetricsResult> {
  const call = input.fetchImpl ?? fetch;
  const token = await accessTokenFor({
    connectionId: input.target.connectionId,
    target: input.target.federation,
    key: input.target.key,
    baseUrl: input.target.baseUrl,
    nowMs: input.nowMs,
    fetchImpl: call,
  });
  if (!token.ok) return { ok: false, reason: token.reason === 'unreachable' ? 'unreachable' : 'no_token', detail: token.detail };

  const wanted = new Set(input.instanceIds.filter(isInstanceId));
  const byInstance = new Map<string, { at: number; value: number }[]>();
  let pageToken: string | null = null;
  let truncated = false;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(`${API}/projects/${encodeURIComponent(input.target.projectId)}/timeSeries`);
    url.searchParams.set('filter', cpuFilter(input.instanceIds));
    url.searchParams.set('interval.startTime', rfc3339(input.startMs));
    url.searchParams.set('interval.endTime', rfc3339(input.endMs));
    url.searchParams.set('aggregation.alignmentPeriod', `${input.alignmentSeconds ?? ALIGNMENT_SECONDS}s`);
    url.searchParams.set('aggregation.perSeriesAligner', 'ALIGN_MEAN');
    // Headers only would drop the points; FULL is what carries them.
    url.searchParams.set('view', 'FULL');
    url.searchParams.set('pageSize', String(PAGE_SIZE));
    if (pageToken !== null) url.searchParams.set('pageToken', pageToken);

    let response: Response;
    try {
      response = await call(url.toString(), { headers: { authorization: `Bearer ${token.data.token}` } });
    } catch {
      return { ok: false, reason: 'unreachable' };
    }
    if (!response.ok) {
      const denied = response.status === 401 || response.status === 403;
      return { ok: false, reason: denied ? 'denied' : 'error' };
    }

    const body = (await response.json()) as { timeSeries?: RawSeries[]; nextPageToken?: string };
    for (const series of body.timeSeries ?? []) {
      const instanceId = series.resource?.labels?.instance_id;
      if (typeof instanceId !== 'string') continue;
      // Asked for a set, so anything outside it is dropped here too: the filter is a request, and the
      // answer is not trusted to have honoured it.
      if (wanted.size > 0 && !wanted.has(instanceId)) continue;

      const points = byInstance.get(instanceId) ?? [];
      for (const point of series.points ?? []) {
        const at = Date.parse(point.interval?.endTime ?? '');
        const value = point.value?.doubleValue;
        // A point Google did not put a number in is not a point. It is never read as zero.
        if (Number.isNaN(at) || typeof value !== 'number' || !Number.isFinite(value)) continue;
        points.push({ at, value });
      }
      byInstance.set(instanceId, points);
    }

    pageToken = typeof body.nextPageToken === 'string' && body.nextPageToken !== '' ? body.nextPageToken : null;
    if (pageToken === null) break;
    // Still more after the last page this will read: said, not silently dropped.
    if (page === MAX_PAGES - 1) truncated = true;
  }

  const data = [...byInstance.entries()].map(([instanceId, points]) => ({
    instanceId,
    points: points.sort((a, b) => a.at - b.at),
  }));
  return { ok: true, data, truncated };
}

/** The most recent point, or null when the instance reported nothing. Never a zero standing in for one. */
export const latestOf = (series: CpuSeries | undefined): number | null =>
  series === undefined || series.points.length === 0 ? null : series.points[series.points.length - 1].value;
