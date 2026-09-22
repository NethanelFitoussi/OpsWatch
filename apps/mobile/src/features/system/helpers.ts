/**
 * System status, read for the one question a phone is held up to answer: **can I trust what the other screens are
 * showing me?**
 *
 * The desktop page is an administrator's console. This is not that. Everything here exists to turn the raw status
 * into a verdict, because an engineer looking at a degraded service needs to know whether OpsWatch is currently
 * collecting before deciding that a flat graph means "nothing happened" rather than "nobody looked".
 *
 * Three states are kept apart on purpose, because conflating them is how a monitoring tool lies:
 * - **never collected**: the screens are empty because OpsWatch has not looked yet;
 * - **stopped**: the screens show the last thing it saw, which is not now;
 * - **collecting**: the screens are current, whatever individual jobs may be failing.
 */
import type { JobStatus, SystemStatus } from '@/api/contract';
import type { MessageKey } from '@/i18n';
import type { IconName } from '@/ui/layout';
import type { Tone } from '@/ui/theme';

/** How long without a heartbeat before a live collector is treated as stale, independent of what it claims. */
export const HEARTBEAT_STALE_MS = 5 * 60_000;

export type CollectorVerdict = 'never' | 'stopped' | 'stale' | 'failing' | 'collecting';

export type Verdict = {
  verdict: CollectorVerdict;
  tone: Tone;
  icon: IconName;
  title: MessageKey;
  /** What it means for everything else in the app. Always present: the verdict alone is not actionable. */
  consequence: MessageKey;
};

const VERDICTS: Record<CollectorVerdict, Omit<Verdict, 'verdict'>> = {
  never: { tone: 'unknown', icon: 'help-circle', title: 'system.verdict.never', consequence: 'system.consequence.never' },
  stopped: { tone: 'critical', icon: 'close-circle', title: 'system.verdict.stopped', consequence: 'system.consequence.stopped' },
  stale: { tone: 'critical', icon: 'alert-circle', title: 'system.verdict.stale', consequence: 'system.consequence.stale' },
  failing: { tone: 'warning', icon: 'warning', title: 'system.verdict.failing', consequence: 'system.consequence.failing' },
  collecting: { tone: 'healthy', icon: 'checkmark-circle', title: 'system.verdict.collecting', consequence: 'system.consequence.collecting' },
};

/**
 * The order matters and is the whole design. "Never collected" outranks everything, because a failing job is
 * irrelevant when nothing has ever run. A heartbeat older than the threshold outranks `alive`, because `alive` is
 * the collector's own claim and a process that died between heartbeats still claims it.
 */
export function collectorVerdict(status: SystemStatus, now: number): Verdict {
  const { collector } = status;
  const key: CollectorVerdict = collector.neverRan
    ? 'never'
    : !collector.alive
      ? 'stopped'
      : collector.heartbeatAt === null || now - collector.heartbeatAt > HEARTBEAT_STALE_MS
        ? 'stale'
        : failingJobs(status.jobs).length > 0
          ? 'failing'
          : 'collecting';
  return { verdict: key, ...VERDICTS[key] };
}

/** A job that ran and failed. A job that has never run is not failing; it is unproven, and shown as such. */
export function failingJobs(jobs: readonly JobStatus[]): JobStatus[] {
  return jobs.filter((job) => job.lastStatus === 'failed');
}

export type JobState = 'running' | 'ok' | 'failed' | 'skipped' | 'never';

const JOB_META: Record<JobState, { tone: Tone; icon: IconName; label: MessageKey }> = {
  running: { tone: 'info', icon: 'sync-circle', label: 'system.job.running' },
  ok: { tone: 'healthy', icon: 'checkmark-circle', label: 'system.job.ok' },
  failed: { tone: 'critical', icon: 'close-circle', label: 'system.job.failed' },
  skipped: { tone: 'unknown', icon: 'remove-circle', label: 'system.job.skipped' },
  never: { tone: 'unknown', icon: 'help-circle', label: 'system.job.never' },
};

/**
 * `lastStatus: null` means the job has never run. The contract is explicit that this differs from having run and
 * failed, and the screen says so rather than showing an empty cell.
 */
export function jobState(job: JobStatus): JobState {
  return job.lastStatus ?? 'never';
}

export function jobMeta(job: JobStatus) {
  return JOB_META[jobState(job)];
}

/** Failures first, then never-run, then the rest; alphabetical inside a group so the order is stable. */
const JOB_RANK: Record<JobState, number> = { failed: 0, never: 1, running: 2, skipped: 3, ok: 4 };

export function sortJobs(jobs: readonly JobStatus[]): JobStatus[] {
  return [...jobs].sort((a, b) => JOB_RANK[jobState(a)] - JOB_RANK[jobState(b)] || a.job.localeCompare(b.job));
}

/**
 * Whether an environment was read completely. `familiesTotal` of 0 means there was nothing to read, which is
 * complete rather than a division by zero.
 */
export function environmentCoverage(read: number, total: number): { complete: boolean; fraction: number | null } {
  if (total <= 0) return { complete: true, fraction: null };
  return { complete: read >= total, fraction: read / total };
}

/** A job whose last run did not cover everything it should have. `null` counts are "not reported", not "none". */
export function isPartial(job: JobStatus): boolean {
  return job.truncated || (job.covered !== null && job.total !== null && job.total > 0 && job.covered < job.total);
}
