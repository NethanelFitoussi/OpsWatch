import 'server-only';
import { analyticsSince } from '../collector/cloudflare-job';
import { readCloudflareConnection } from '../cloudflare/connection';
import type { Db } from '../db/client';
import { listDaysForZones } from '../store/cloudflare';

/**
 * What connecting Cloudflare bought, in figures an operator can act on (CF-2).
 *
 * Every number is a count Cloudflare reported or a ratio of two of them, so anything on the page can be
 * recomputed from the stored rows and checked against the provider. Nothing is estimated and nothing is
 * modelled.
 *
 * **Ratios are null rather than zero when there is nothing to divide by.** A zone with no traffic has not
 * got a 0 % cache hit rate; it has no cache hit rate, and showing one would be the tool inventing a
 * measurement out of an absence (§2.4).
 */

export type ZonePoint = {
  date: string;
  requests: number;
  cachedRequests: number;
  bytes: number;
  cachedBytes: number;
  threats: number;
  clientErrors: number;
  serverErrors: number;
  uniques: number | null;
};

export type ZoneSummary = {
  id: string;
  name: string;
  /** Totals over the window, and the ratios that mean something only when there was traffic. */
  requests: number;
  bytes: number;
  threats: number;
  cacheHitRate: number | null;
  cachedByteShare: number | null;
  clientErrorRate: number | null;
  serverErrorRate: number | null;
  /** How the last day compares with the one before, as a ratio. Null on the first day of data. */
  requestsTrend: number | null;
  days: ZonePoint[];
};

export type CloudflareOverview = {
  state: 'not_connected' | 'unverified' | 'no_zones' | 'no_data' | 'ready';
  zones: ZoneSummary[];
  /** Totals across every selected zone, for the figure at the top of the page. */
  totals: { requests: number; bytes: number; threats: number; cacheHitRate: number | null; serverErrorRate: number | null };
};

const share = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);

export function readCloudflareOverview(db: Db, nowMs: number): CloudflareOverview {
  const empty = { requests: 0, bytes: 0, threats: 0, cacheHitRate: null, serverErrorRate: null };
  const connection = readCloudflareConnection(db);
  if (connection === null) return { state: 'not_connected', zones: [], totals: empty };
  // A saved token nobody proved reads nothing, and the page says which of the two it is.
  if (connection.status !== 'configured') return { state: 'unverified', zones: [], totals: empty };
  if (connection.zones.length === 0) return { state: 'no_zones', zones: [], totals: empty };

  const rows = listDaysForZones(db, connection.zones.map((zone) => zone.id), analyticsSince(nowMs));
  const byZone = new Map<string, ZonePoint[]>();
  for (const row of rows) {
    const points = byZone.get(row.zoneId) ?? [];
    points.push({
      date: row.date,
      requests: row.requests,
      cachedRequests: row.cachedRequests,
      bytes: row.bytes,
      cachedBytes: row.cachedBytes,
      threats: row.threats,
      clientErrors: row.clientErrors,
      serverErrors: row.serverErrors,
      uniques: row.uniques,
    });
    byZone.set(row.zoneId, points);
  }

  const zones: ZoneSummary[] = connection.zones.map((zone) => {
    const days = byZone.get(zone.id) ?? [];
    const sum = (pick: (point: ZonePoint) => number) => days.reduce((total, point) => total + pick(point), 0);
    const requests = sum((point) => point.requests);
    const last = days[days.length - 1];
    const previous = days[days.length - 2];
    return {
      id: zone.id,
      name: zone.name,
      requests,
      bytes: sum((point) => point.bytes),
      threats: sum((point) => point.threats),
      cacheHitRate: share(sum((point) => point.cachedRequests), requests),
      cachedByteShare: share(sum((point) => point.cachedBytes), sum((point) => point.bytes)),
      clientErrorRate: share(sum((point) => point.clientErrors), requests),
      serverErrorRate: share(sum((point) => point.serverErrors), requests),
      // Two days or it is not a trend. A first day compared with nothing is not "up 100 %".
      requestsTrend: previous === undefined || last === undefined || previous.requests === 0 ? null : last.requests / previous.requests - 1,
      days,
    };
  });

  const totalRequests = zones.reduce((total, zone) => total + zone.requests, 0);
  return {
    // Connected and watching zones, but nothing fetched yet, is its own state: the job runs every six
    // hours, and "no traffic" and "not read yet" are different answers (§2.6).
    state: rows.length === 0 ? 'no_data' : 'ready',
    zones,
    totals: {
      requests: totalRequests,
      bytes: zones.reduce((total, zone) => total + zone.bytes, 0),
      threats: zones.reduce((total, zone) => total + zone.threats, 0),
      cacheHitRate: share(
        zones.reduce((total, zone) => total + zone.days.reduce((inner, day) => inner + day.cachedRequests, 0), 0),
        totalRequests,
      ),
      serverErrorRate: share(
        zones.reduce((total, zone) => total + zone.days.reduce((inner, day) => inner + day.serverErrors, 0), 0),
        totalRequests,
      ),
    },
  };
}
