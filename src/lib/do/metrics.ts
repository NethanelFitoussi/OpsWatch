import 'server-only';
import type { DoTarget } from './target';
import type { DoTestFailure } from './result';

/**
 * Agentless droplet metrics from DigitalOcean.
 *
 * **What is agentless here is not what is agentless on Google, and the difference is the point.**
 * DigitalOcean measures public and private bandwidth, disk I/O and disk usage outside the droplet;
 * **CPU, load average and memory come from `do-agent`**, which runs inside it. Google is the other way
 * round: CPU is written by the hypervisor and memory needs the Ops Agent. So there is no metric both
 * clouds give for nothing, and CPU — the first thing anyone reaches for — is agentless on one and not
 * the other. A page that showed "CPU" for both without saying which was measured would be inventing
 * parity DigitalOcean does not offer.
 *
 * OpsWatch installs neither agent and does not offer to. What it can read without one, it reads.
 *
 * Verified against the current reference rather than from memory:
 *
 *   - `GET /v2/monitoring/metrics/droplet/bandwidth`, with `host_id`, `interface` (`public` or
 *     `private`), `direction` (`inbound` or `outbound`), `start` and `end` as Unix **seconds**
 *   - the answer is `data.result[]`, each with `metric` labels and `values` of
 *     `[unixSeconds, "decimal string"]` — the figure is a **string**, and parsing it is not optional
 *   - bandwidth is in **megabits per second**
 */

const API = 'https://api.digitalocean.com/v2';

/**
 * What DigitalOcean measures from outside the droplet.
 *
 * Bandwidth and disk I/O, and **not** disk usage: an earlier version of this list had it, on the
 * strength of a graphs page calling it a default chart. A hypervisor can count a guest's packets and
 * its block-device operations; how full a filesystem *inside* that guest is, it cannot see. Rather
 * than assert either way from a page that does not say, the claim is limited to what is established.
 */
export const DO_AGENTLESS_METRICS = ['bandwidth', 'disk_io'] as const;
/** What it does not. Named so the page can say which, rather than leaving a column out. */
export const DO_AGENT_METRICS = ['cpu', 'load_average', 'memory'] as const;

/**
 * How many droplets a page reads bandwidth for.
 *
 * Each droplet costs **two** requests — inbound and outbound are separate calls — and DigitalOcean
 * allows 250 a minute. Twelve droplets is twenty-four requests, comfortably inside that with room for
 * whatever else the instance is doing. Past it the rest of the list is shown without a figure and the
 * page says so, rather than either hanging or quietly showing the first twelve as though they were all.
 */
export const BANDWIDTH_DROPLET_CAP = 12;

export type BandwidthPoint = { at: number; inbound: number | null; outbound: number | null };
export type DropletBandwidth = { dropletId: number; points: BandwidthPoint[] };

export type DoMetricsResult =
  | { ok: true; data: DropletBandwidth[]; truncated: boolean }
  | { ok: false; reason: DoTestFailure };

function failureOf(status: number): DoTestFailure {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  return 'error';
}

type RawSeries = { metric?: Record<string, string>; values?: [number, string][] };

/**
 * One direction of one droplet's public bandwidth.
 *
 * Returns null for a refusal the caller should report and an empty series for a droplet that simply
 * reported nothing — which are different, and only the first should colour the whole page.
 */
async function oneDirection(
  target: DoTarget,
  dropletId: number,
  direction: 'inbound' | 'outbound',
  startSeconds: number,
  endSeconds: number,
  call: typeof fetch,
): Promise<{ ok: true; points: Map<number, number> } | { ok: false; reason: DoTestFailure }> {
  const url = new URL(`${API}/monitoring/metrics/droplet/bandwidth`);
  url.searchParams.set('host_id', String(dropletId));
  // Public only. Private traffic exists on some droplets and not others, and a blank column on the
  // ones without it would read as "no traffic" rather than "no private network".
  url.searchParams.set('interface', 'public');
  url.searchParams.set('direction', direction);
  url.searchParams.set('start', String(startSeconds));
  url.searchParams.set('end', String(endSeconds));

  let response: Response;
  try {
    response = await call(url.toString(), { headers: { authorization: `Bearer ${target.token}`, accept: 'application/json' } });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  if (!response.ok) return { ok: false, reason: failureOf(response.status) };

  const body = (await response.json()) as { data?: { result?: RawSeries[] } };
  const points = new Map<number, number>();
  for (const series of body.data?.result ?? []) {
    for (const [seconds, raw] of series.values ?? []) {
      // The figure arrives as a string. `Number('')` is 0, which is why this is a parse and a check
      // rather than a coercion: an empty string read as zero is a droplet shown as silent.
      const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
      if (typeof seconds !== 'number' || !Number.isFinite(value)) continue;
      points.set(seconds * 1000, value);
    }
  }
  return { ok: true, points };
}

/**
 * Public bandwidth for up to `BANDWIDTH_DROPLET_CAP` droplets, in megabits per second.
 *
 * A droplet DigitalOcean reported nothing for keeps an empty series: `null` on a point means "not
 * measured", never zero. A droplet that is off has no traffic *and* no measurement, and the two are
 * not the same statement.
 */
export async function dropletBandwidth(input: {
  target: DoTarget;
  dropletIds: readonly number[];
  startMs: number;
  endMs: number;
  fetchImpl?: typeof fetch;
}): Promise<DoMetricsResult> {
  const call = input.fetchImpl ?? fetch;
  const ids = input.dropletIds.filter((id) => Number.isInteger(id) && id > 0);
  const read = ids.slice(0, BANDWIDTH_DROPLET_CAP);
  const startSeconds = Math.floor(input.startMs / 1000);
  const endSeconds = Math.floor(input.endMs / 1000);

  const answers = await Promise.all(
    read.map(async (dropletId) => {
      const [inbound, outbound] = await Promise.all([
        oneDirection(input.target, dropletId, 'inbound', startSeconds, endSeconds, call),
        oneDirection(input.target, dropletId, 'outbound', startSeconds, endSeconds, call),
      ]);
      return { dropletId, inbound, outbound };
    }),
  );

  // One refusal is the answer for the page: a token without the scope, or a rate limit, is not a
  // property of one droplet, and showing eleven figures and one blank would hide why.
  for (const answer of answers) {
    if (!answer.inbound.ok) return { ok: false, reason: answer.inbound.reason };
    if (!answer.outbound.ok) return { ok: false, reason: answer.outbound.reason };
  }

  const data = answers.map(({ dropletId, inbound, outbound }) => {
    const inPoints = inbound.ok ? inbound.points : new Map<number, number>();
    const outPoints = outbound.ok ? outbound.points : new Map<number, number>();
    const times = [...new Set([...inPoints.keys(), ...outPoints.keys()])].sort((a, b) => a - b);
    return {
      dropletId,
      points: times.map((at) => ({
        at,
        // Absent on one side and present on the other is normal — the two calls are aligned by
        // DigitalOcean, not by us — and the missing side stays null rather than becoming a zero.
        inbound: inPoints.get(at) ?? null,
        outbound: outPoints.get(at) ?? null,
      })),
    };
  });

  return { ok: true, data, truncated: ids.length > read.length };
}

/** The most recent point that has a figure on the asked-for side, or null. Never a zero standing in. */
export function latestBandwidth(series: DropletBandwidth | undefined, direction: 'inbound' | 'outbound'): number | null {
  if (series === undefined) return null;
  for (let index = series.points.length - 1; index >= 0; index -= 1) {
    const value = series.points[index][direction];
    if (value !== null) return value;
  }
  return null;
}
