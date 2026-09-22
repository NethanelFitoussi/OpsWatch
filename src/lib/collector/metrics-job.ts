import 'server-only';
import type { Db } from '../db/client';
import { opswatchDbProvider } from '../history/opswatch-db';
import { RESOLUTION_MS, type HistoryPoint } from '../history/provider';
import { readHistorySettings } from '../history/settings';
import { INSIGHT_FAMILIES, loadFamily } from '../monitoring/overview';
import { resolveTarget } from '../monitoring/target';
import { JOBS } from './jobs';
import type { JobOutcome } from './runner';

/**
 * The `metrics` job: rollups, **behind the history switch** (Task 24, §31.1).
 *
 * The first thing it does is ask whether it is allowed to run at all, and on a fresh installation the answer
 * is no. That is the owner's binding ruling — a fresh install must never add AWS polling cost without an
 * explicit action — and it is enforced here rather than by remembering to configure something.
 *
 * What it writes goes through `HistoricalStorageProvider`, so an operator who points history at another
 * backend changes one setting and this job does not know the difference.
 */
export const METRICS_RESOLUTION = '5m' as const;

export type MetricsJobInput = {
  db: Db;
  connectionId: string;
  scope: string;
  nowMs: number;
};

export async function runMetricsJob(input: MetricsJobInput): Promise<JobOutcome> {
  const settings = readHistorySettings(input.db);
  // Off is the default and the common case: no AWS request is made, and the run records that it did nothing.
  if (!settings.enabled) return { covered: 0, total: 0 };

  const target = await resolveTarget({ connectionId: input.connectionId, region: input.scope });
  if (!target.ok) throw new Error('connection_unavailable');

  const provider = opswatchDbProvider(input.db);
  // The interval this cycle covers, aligned so two writers agree which bucket a reading belongs to.
  const intervalStart = Math.floor(input.nowMs / RESOLUTION_MS[METRICS_RESOLUTION]) * RESOLUTION_MS[METRICS_RESOLUTION] - RESOLUTION_MS[METRICS_RESOLUTION];

  const points: HistoryPoint[] = [];
  let read = 0;
  const cap = JOBS.metrics.cap ?? Number.POSITIVE_INFINITY;

  for (const family of INSIGHT_FAMILIES) {
    if (points.length >= cap) break;
    const result = await loadFamily(family, target.data, input.nowMs);
    if (!result.ok) continue;
    read += 1;
    points.push({
      category: 'metric',
      subjectId: family,
      metric: 'affected',
      connectionId: input.connectionId,
      scope: input.scope,
      intervalStart,
      resolution: METRICS_RESOLUTION,
      // What the family actually measured. `null` would be the answer if it could not be read, and a family
      // that could not be read is skipped above rather than written as zero.
      value: result.data.affected,
      samples: 1,
    });
    points.push({
      category: 'metric',
      subjectId: family,
      metric: 'total',
      connectionId: input.connectionId,
      scope: input.scope,
      intervalStart,
      resolution: METRICS_RESOLUTION,
      value: result.data.total,
      samples: 1,
    });
  }

  await provider.write(points, input.nowMs);
  return {
    covered: read,
    total: INSIGHT_FAMILIES.length,
    truncated: read < INSIGHT_FAMILIES.length || points.length >= cap,
  };
}
