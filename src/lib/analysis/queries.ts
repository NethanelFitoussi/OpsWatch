import 'server-only';
import type { AwsTarget, MonitoringDeps } from '../monitoring/call';
import { FLEET_SQL_LIMIT, PI_GROUPS, piWindow, topDimensionKeys, type PiDimensionKey, type PiGroup } from '../monitoring/pi';
import { listDatabases } from '../monitoring/rds';
import type { MonitoringResult } from '../monitoring/result';
import { subsectionPath } from '../monitoring/shared/paths';
import type { TimeRange, TimeWindow } from '../monitoring/shared/time-range';
import { isOneOf } from '../type-guards';
import {
  QUERIES_MAX_INSTANCES,
  capResources,
  coverageOf,
  notCovered,
  notCoveredFromFailure,
  sortNotCovered,
  type Coverage,
  type NotCovered,
} from './coverage';

/** Where one row's load comes from: one instance, with its share of that row. */
export type FleetQueryOrigin = { instance: string; load: number; sharePercent: number; href: string };
export type FleetQueryRow = { key: string; label: string; totalLoad: number; sharePercent: number; instanceCount: number; origins: FleetQueryOrigin[] };
export type FleetQueriesData = {
  group: PiGroup;
  rows: FleetQueryRow[];
  totalLoad: number;
  coverage: Coverage;
  notCovered: NotCovered[];
  window: TimeWindow;
  limitPerInstance: number;
};

export const QUERY_SORTS = ['load', 'instances'] as const;
export type QuerySort = (typeof QUERY_SORTS)[number];

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The grouping the user chose; statements when the query string says nothing this page understands. */
export function parseQueryGroup(value: string | string[] | undefined): PiGroup {
  const name = first(value);
  return isOneOf(PI_GROUPS, name) ? name : 'sql';
}

export function parseQuerySort(value: string | string[] | undefined): QuerySort {
  const name = first(value);
  return isOneOf(QUERY_SORTS, name) ? name : 'load';
}

type InstanceKeys = { instance: string; href: string; keys: readonly PiDimensionKey[] };
type Bucket = { key: string; label: string; labelLoad: number; totalLoad: number; origins: { instance: string; load: number; href: string }[] };

const byName = (a: string, b: string) => a.localeCompare(b, 'en');
const share = (part: number, whole: number) => (whole === 0 ? 0 : (part * 100) / whole);

/**
 * Merges the per-instance top lists into one table.
 *
 * Rows merge on the **id** dimension only (amendment 3). AWS truncates `db.sql_tokenized.statement` at
 * 500 bytes, so two different statements can arrive with identical text; merging on the text would fuse
 * them into one row that exists nowhere. A key that arrives without an id therefore cannot be merged at
 * all and becomes a row of its own, per instance.
 *
 * Every instance was asked over the *same* window, so the per-instance loads are directly comparable and
 * a row's load is a plain sum — do not "fix" this into a weighted average, there is nothing to weight by.
 *
 * `sharePercent` is the share of the load **of the statements shown** (amendment 4), not of any instance's
 * total database load: the callers only ever saw each instance's top list.
 */
export function mergeFleetKeys(perInstance: readonly InstanceKeys[], sort: QuerySort): { rows: FleetQueryRow[]; totalLoad: number } {
  const buckets = new Map<string, Bucket>();
  for (const { instance, href, keys } of perInstance) {
    keys.forEach((entry, index) => {
      const key = entry.id ?? `no-id:${instance}:${index}`;
      const bucket = buckets.get(key) ?? { key, label: entry.label, labelLoad: -Infinity, totalLoad: 0, origins: [] };
      bucket.totalLoad += entry.load;
      // The text shown is the one from the instance that suffers most from this key.
      if (entry.load > bucket.labelLoad) {
        bucket.label = entry.label;
        bucket.labelLoad = entry.load;
      }
      bucket.origins.push({ instance, load: entry.load, href });
      buckets.set(key, bucket);
    });
  }

  const totalLoad = [...buckets.values()].reduce((sum, bucket) => sum + bucket.totalLoad, 0);
  const rows = [...buckets.values()].map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    totalLoad: bucket.totalLoad,
    sharePercent: share(bucket.totalLoad, totalLoad),
    instanceCount: bucket.origins.length,
    origins: bucket.origins
      .sort((a, b) => b.load - a.load || byName(a.instance, b.instance))
      .map((origin) => ({ ...origin, sharePercent: share(origin.load, bucket.totalLoad) })),
  }));

  rows.sort((a, b) =>
    sort === 'instances'
      ? b.instanceCount - a.instanceCount || b.totalLoad - a.totalLoad || byName(a.key, b.key)
      : b.totalLoad - a.totalLoad || b.instanceCount - a.instanceCount || byName(a.key, b.key),
  );
  return { rows, totalLoad };
}

/**
 * One Performance Insights call per instance (amendment 11), for the one grouping asked for (amendment 5),
 * merged into a single table. Only the instance list failing fails the page: an instance that denies or
 * times out stays visible in `notCovered` with its error code.
 */
export async function fleetQueries(
  target: AwsTarget,
  options: { group: PiGroup; sort: QuerySort; range: TimeRange; nowMs: number },
  deps: MonitoringDeps = {},
): Promise<MonitoringResult<FleetQueriesData>> {
  const databases = await listDatabases(target, deps);
  if (!databases.ok) return databases;

  const instances = databases.data.instances;
  // Narrowed to the pair the call needs, so the non-null resource id survives the cap.
  const eligible: { id: string; resourceId: string }[] = [];
  const missing: NotCovered[] = [];
  for (const i of instances) {
    if (i.resourceId === null) missing.push(notCovered(i.id, 'no_resource_id'));
    else if (!i.performanceInsights) missing.push(notCovered(i.id, 'pi_disabled'));
    else eligible.push({ id: i.id, resourceId: i.resourceId });
  }

  // One call per instance, so the cost of a resource is exactly 1.
  const { included, excluded } = capResources(eligible, 1, QUERIES_MAX_INSTANCES);
  const window = piWindow(options.range, options.nowMs);
  const answers = await Promise.all(included.map((i) => topDimensionKeys(target, i.resourceId, window, options.group, FLEET_SQL_LIMIT, deps)));

  const perInstance: InstanceKeys[] = [];
  const failed: NotCovered[] = [];
  included.forEach((i, index) => {
    const answer = answers[index];
    if (answer.ok) perInstance.push({ instance: i.id, href: subsectionPath(target, 'databases', 'instances', i.id), keys: answer.data });
    else failed.push(notCoveredFromFailure(i.id, answer));
  });

  const { rows, totalLoad } = mergeFleetKeys(perInstance, options.sort);
  return {
    ok: true,
    data: {
      group: options.group,
      rows,
      totalLoad,
      // Stricter than the cap's own coverage: an instance that failed did not contribute either.
      coverage: coverageOf(perInstance.length, instances.length),
      notCovered: sortNotCovered([...missing, ...excluded.map((i) => notCovered(i.id, 'cap')), ...failed]),
      window,
      limitPerInstance: FLEET_SQL_LIMIT,
    },
  };
}
