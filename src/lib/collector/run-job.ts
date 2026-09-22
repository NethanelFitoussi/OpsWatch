import 'server-only';
import type { JobRun } from './runner';

/**
 * What each job actually does. One place, so the runner never knows a job's business and a job never knows
 * about locks, schedules or `collector_runs`.
 *
 * Tasks 10 and 11 fill this in: `inventory` and `detect` first, then `compact`. Until a job has an
 * implementation it reports that it covered nothing — which System status shows as a run that did no work,
 * rather than as a success that quietly did nothing.
 */
export const runJob: JobRun = async (job) => {
  switch (job.id) {
    default:
      return { covered: 0, total: 0 };
  }
};
