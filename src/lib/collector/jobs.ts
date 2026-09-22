import 'server-only';

/**
 * The job catalogue of §9.2: what the collector can run, how often, and what bounds one cycle.
 *
 * The schedule lives here and nowhere else, so changing how often something runs is one edit and a fixture
 * update — the same discipline the score weights have.
 */
export const JOB_IDS = [
  'metrics',
  'detect',
  'deployments',
  'inventory',
  'queries',
  'errors',
  'logvolume',
  'baselines',
  'slo',
  'compact',
] as const;
export type JobId = (typeof JOB_IDS)[number];

export type JobSpec = {
  id: JobId;
  everyMs: number;
  /**
   * What bounds one cycle, as §9.2 fixes it: series, describe calls, or queries. `null` where the work is
   * inherently bounded — `compact` runs over what is already stored and asks AWS for nothing.
   */
  cap: number | null;
  /** Whether the job runs once per connection-and-region pair, or once for the whole instance. */
  scope: 'environment' | 'instance';
  /**
   * Whether a fresh installation runs it. **D4**: only the three that cost no extra AWS request. Everything
   * else waits for the operator to turn something on — the history switch, or a log source.
   */
  freshInstall: boolean;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const JOBS: Record<JobId, JobSpec> = {
  // Behind the history switch (Task 24): rollups are what §33.2 calls a storage-provider concern.
  metrics: { id: 'metrics', everyMs: 5 * MINUTE, cap: 500, scope: 'environment', freshInstall: false },
  // Runs over data the pages already fetched, so it costs nothing extra.
  detect: { id: 'detect', everyMs: 5 * MINUTE, cap: null, scope: 'environment', freshInstall: true },
  deployments: { id: 'deployments', everyMs: 5 * MINUTE, cap: 100, scope: 'environment', freshInstall: false },
  // `Describe*` calls: §9.5 records them as throttled but not billed.
  inventory: { id: 'inventory', everyMs: 30 * MINUTE, cap: 60, scope: 'environment', freshInstall: true },
  queries: { id: 'queries', everyMs: 30 * MINUTE, cap: 25, scope: 'environment', freshInstall: false },
  /**
   * One bounded Logs Insights query per opted-in source. It is on from the start because a fresh install has
   * no enabled source, so the job finds nothing to do and costs nothing — and the moment an operator opts a
   * log group in, collection begins without their having to find a second switch.
   */
  errors: { id: 'errors', everyMs: 15 * MINUTE, cap: 1, scope: 'environment', freshInstall: true },
  logvolume: { id: 'logvolume', everyMs: HOUR, cap: 100, scope: 'environment', freshInstall: false },
  baselines: { id: 'baselines', everyMs: HOUR, cap: 500, scope: 'environment', freshInstall: false },
  slo: { id: 'slo', everyMs: HOUR, cap: 100, scope: 'environment', freshInstall: false },
  // Retention and the backup: one instance-wide pass, touching no provider.
  compact: { id: 'compact', everyMs: 24 * HOUR, cap: null, scope: 'instance', freshInstall: true },
};

/** What a fresh installation runs, and the whole of it (**D4**). */
export const FRESH_INSTALL_JOBS: JobId[] = JOB_IDS.filter((id) => JOBS[id].freshInstall);
