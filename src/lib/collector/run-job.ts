import 'server-only';
import { getDb } from '../db/client';
import { env } from '../env';
import { runDetectJob } from './detect';
import { runErrorsJob } from './errors-job';
import type { JobRun } from './runner';

/**
 * What each job actually does. One place, so the runner never knows a job's business and a job never knows
 * about locks, schedules or `collector_runs`.
 *
 * A job without an implementation reports that it covered nothing, which System status shows as a run that
 * did no work rather than as a success that quietly did nothing.
 */
export const runJob: JobRun = async (job, nowMs) => {
  if (job.connectionId === null || job.scope === null) return { covered: 0, total: 0 };
  const scoped = { db: getDb(), connectionId: job.connectionId, scope: job.scope, nowMs };

  switch (job.id) {
    case 'detect':
      return runDetectJob(scoped);
    case 'errors':
      return runErrorsJob({ ...scoped, budgetGbPerDay: env().OPSWATCH_LOGS_BUDGET_GB_PER_DAY });
    default:
      return { covered: 0, total: 0 };
  }
};
