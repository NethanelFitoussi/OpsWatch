import 'server-only';
import { getDb } from '../db/client';
import { runDetectJob } from './detect';
import type { JobRun } from './runner';

/**
 * What each job actually does. One place, so the runner never knows a job's business and a job never knows
 * about locks, schedules or `collector_runs`.
 *
 * A job without an implementation reports that it covered nothing, which System status shows as a run that
 * did no work rather than as a success that quietly did nothing.
 */
export const runJob: JobRun = async (job, nowMs) => {
  if (job.id === 'detect' && job.connectionId !== null && job.scope !== null) {
    return runDetectJob({ db: getDb(), connectionId: job.connectionId, scope: job.scope, nowMs });
  }
  return { covered: 0, total: 0 };
};
