import 'server-only';
import type { AwsTarget, MonitoringDeps } from './call';
import { searchLogGroups, type LogGroup } from './logs';
import { getMetricSeries, seriesById, type MetricQuery } from './metrics';
import type { MonitoringResult } from './result';
import type { TimeWindow } from './shared/time-range';

/**
 * Log volume and retention (§18), **without an ingestion pipeline and without a query**.
 *
 * Ingestion comes from the `AWS/Logs` `IncomingBytes` metric and the rest from `DescribeLogGroups`. Neither
 * is billed per gigabyte scanned, so this page — unlike everything else in the Logs section — costs nothing
 * against `OPSWATCH_LOGS_BUDGET_GB_PER_DAY`. That is the whole reason §18 puts volume here rather than
 * behind a Logs Insights query.
 */

/** How many groups one page covers. Metric queries are batched, and an account can have thousands. */
export const VOLUME_GROUP_LIMIT = 50;

export type GroupVolume = {
  name: string;
  /** Bytes ingested over the window, or null when the metric returned nothing for this group. */
  ingestedBytes: number | null;
  /** Bytes currently stored, or null when AWS did not report it. Never zero standing in for unknown. */
  storedBytes: number | null;
  /** Null means the group is kept forever, which is a finding rather than a missing value. */
  retentionDays: number | null;
  /** This group's share of the ingestion this page measured, 0–1, or null when nothing was measured. */
  share: number | null;
};

export type VolumeView = {
  groups: GroupVolume[];
  totalIngestedBytes: number | null;
  /** How many groups the account has beyond the ones covered, so a truncated page says so (§2.4). */
  covered: number;
  truncated: boolean;
};

/** One query per group. `Sum` over the window is what "how much did this group ingest" means. */
export function volumeQueries(groups: readonly LogGroup[]): MetricQuery[] {
  return groups.map((group, index) => ({
    id: `v${index}`,
    namespace: 'AWS/Logs',
    metricName: 'IncomingBytes',
    dimensions: { LogGroupName: group.name },
    stat: 'Sum' as const,
    label: group.name,
  }));
}

/**
 * Sums a series. Returns null rather than 0 when there were no datapoints at all: a group CloudWatch has no
 * metric for is unmeasured, and a group that genuinely ingested nothing is a different fact.
 */
export function sumSeries(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0);
}

/** Ranks by ingestion, largest first, with the unmeasured ones last rather than treated as zero. */
export function rankByIngestion(groups: readonly GroupVolume[]): GroupVolume[] {
  return [...groups].sort((a, b) => {
    if (a.ingestedBytes === null && b.ingestedBytes === null) return a.name.localeCompare(b.name);
    if (a.ingestedBytes === null) return 1;
    if (b.ingestedBytes === null) return -1;
    return b.ingestedBytes - a.ingestedBytes || a.name.localeCompare(b.name);
  });
}

/** Each group's share of what this page measured. Null total means nothing was measured, so no shares exist. */
export function withShares(groups: readonly GroupVolume[]): { groups: GroupVolume[]; total: number | null } {
  const measured = groups.filter((group) => group.ingestedBytes !== null);
  if (measured.length === 0) return { groups: [...groups], total: null };
  const total = measured.reduce((sum, group) => sum + (group.ingestedBytes ?? 0), 0);
  return {
    groups: groups.map((group) => ({
      ...group,
      // A zero total would make every share NaN, so it stays null and the page says "not measured".
      share: group.ingestedBytes === null || total === 0 ? null : group.ingestedBytes / total,
    })),
    total,
  };
}

export async function loadLogVolume(
  target: AwsTarget,
  window: TimeWindow,
  deps: MonitoringDeps = {},
): Promise<MonitoringResult<VolumeView>> {
  // An unsearched listing carries `storedBytes`, which a pattern search does not.
  const listed = await searchLogGroups(target, '', deps);
  if (!listed.ok) return listed;

  const groups = listed.data.slice(0, VOLUME_GROUP_LIMIT);
  if (groups.length === 0) {
    return { ok: true, data: { groups: [], totalIngestedBytes: null, covered: 0, truncated: false } };
  }

  const series = await getMetricSeries(target, volumeQueries(groups), window, deps);
  if (!series.ok) return series;

  const measured: GroupVolume[] = groups.map((group, index) => ({
    name: group.name,
    ingestedBytes: sumSeries(seriesById(series.data, `v${index}`).values),
    storedBytes: group.storedBytes,
    retentionDays: group.retentionDays,
    share: null,
  }));

  const { groups: shared, total } = withShares(rankByIngestion(measured));
  return {
    ok: true,
    data: {
      groups: shared,
      totalIngestedBytes: total,
      covered: groups.length,
      truncated: listed.data.length > VOLUME_GROUP_LIMIT,
    },
  };
}
