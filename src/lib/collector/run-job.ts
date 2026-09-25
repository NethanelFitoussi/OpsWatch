import 'server-only';
import { getDb } from '../db/client';
import { env } from '../env';
import { runBaselinesJob } from './baselines-job';
import { runCloudflareJob } from './cloudflare-job';
import { runCompactJob } from './compact-job';
import { runDeploymentsJob } from './deployments-job';
import { runDetectJob } from './detect';
import { runDigestJob } from './digest-job';
import { runErrorsJob } from './errors-job';
import { runIngestJob } from './ingest-job';
import { runMetricsJob } from './metrics-job';
import { runNotifyJob } from './notify-job';
import { runSyntheticsJob } from './synthetics-job';
import type { JobRun } from './runner';

/**
 * What each job actually does. One place, so the runner never knows a job's business and a job never knows
 * about locks, schedules or `collector_runs`.
 *
 * There is no longer such a thing as a job without an implementation: the catalogue holds only jobs that
 * do work, and `tests/unit/collector-jobs.test.ts` holds it that way. The `default` below is what the
 * compiler needs, not a place for one to hide.
 */
export const runJob: JobRun = async (job, nowMs) => {
  const db = getDb();

  // An instance-scoped job has no connection by definition, so it is dispatched before the check below.
  // Treating "no connection" as "nothing to do" is what made `compact` a setting that never took effect.
  if (job.id === 'compact') return runCompactJob({ db, nowMs });
  // Also instance-scoped: a zone belongs to the installation, not to an AWS account and region.
  if (job.id === 'cloudflare') return runCloudflareJob({ db, nowMs });
  // Also instance-scoped: a destination belongs to the installation, and with none this is free.
  if (job.id === 'notify') return runNotifyJob(db, env().OPSWATCH_SECRET, nowMs);
  // Also instance-scoped, and with the weekly summary off — the default — it reads one row and stops.
  if (job.id === 'digest') return runDigestJob({ db, nowMs });
  // Also instance-scoped: the ingestion queue is one table for every integration.
  if (job.id === 'ingest') return runIngestJob({ db, nowMs });

  if (job.connectionId === null || job.scope === null) return { covered: 0, total: 0 };
  const scoped = { db, connectionId: job.connectionId, scope: job.scope, nowMs };

  switch (job.id) {
    case 'detect':
      return runDetectJob(scoped);
    case 'deployments':
      return runDeploymentsJob(scoped);
    case 'errors':
      return runErrorsJob({ ...scoped, budgetGbPerDay: env().OPSWATCH_LOGS_BUDGET_GB_PER_DAY });
    case 'synthetics':
      // Nothing runs until an operator enables a check: the job finds none and reports it did nothing.
      return runSyntheticsJob({ ...scoped, secret: env().OPSWATCH_SECRET });
    case 'metrics':
      // It checks the history switch itself and does nothing while history is off (§31.1).
      return runMetricsJob(scoped);
    case 'baselines':
      // Reads only what is already stored, so it asks AWS for nothing and is free to look back four weeks.
      return runBaselinesJob(scoped);
    default:
      // Unreachable: every environment-scoped id is handled above, and the type says so.
      return { covered: 0, total: 0 };
  }
};
