import type { Host, HostDisk } from '@opswatch/contract';

/**
 * What is wrong with a Linux host, from its own last reading.
 *
 * **Not a Problem in the §4 sense, and deliberately not called one.** The problem pipeline — detection,
 * alerts, incidents, reports — is scoped to an AWS connection and region, because everything in it so
 * far has been. A host has neither: it is a machine, and it exists whether or not anybody is watching a
 * cloud account. Filing host findings into that table would mean either inventing an AWS environment
 * for a machine that has none, or making `problems.connection_id` nullable — which every scoped read in
 * the product would then silently exclude. That is a change worth making on purpose, not one to smuggle
 * in behind a disk-space check.
 *
 * So these are findings, shown where the host is, and the roadmap records what it would take to make
 * them problems.
 *
 * Pure: no clock beyond the one it is given, no database, no network. Every rule reads a figure the
 * agent actually measured, and a figure it could not measure produces no finding at all — a disk whose
 * size is unknown is not a disk that is full.
 */

export type HostFindingKind =
  | 'stopped_reporting'
  | 'disk_nearly_full'
  | 'disk_full'
  | 'memory_nearly_exhausted'
  /** Redis may grow until the kernel intervenes, and it is using enough of the machine to matter. */
  | 'redis_no_memory_limit'
  | 'redis_near_memory_limit'
  | 'redis_last_save_failed';
export type HostFindingLevel = 'warning' | 'critical';

export type HostFinding = {
  kind: HostFindingKind;
  level: HostFindingLevel;
  /** What it is about: a mount point, or the machine itself. */
  subject: string;
  /** The measured figure behind it, so a page never states a finding without its evidence. */
  percent: number | null;
};

/** A disk this full is worth saying something about; this full is worth saying it loudly. */
export const DISK_WARNING_PERCENT = 85;
export const DISK_CRITICAL_PERCENT = 95;
/** Memory is noisier than disk, so the bar is higher before it is worth a word. */
export const MEMORY_WARNING_PERCENT = 92;

/**
 * Redis without a `maxmemory` is only worth saying when Redis is actually big on this machine.
 *
 * No limit is a legitimate configuration — on a box that exists to run Redis, the machine's memory
 * *is* the limit, and an operator who chose that does not need telling every day. It becomes worth a
 * word when the two facts meet: no ceiling, and enough of the machine already used that reaching the
 * machine's own is a plausible afternoon.
 */
export const REDIS_SHARE_WARNING_PERCENT = 25;
/** How close to its own limit Redis gets before eviction stops being hypothetical. */
export const REDIS_LIMIT_WARNING_PERCENT = 90;

const percentOf = (used: number | null, total: number | null): number | null =>
  used === null || total === null || total <= 0 ? null : (used / total) * 100;

function diskFinding(disk: HostDisk): HostFinding | null {
  const percent = percentOf(disk.usedBytes, disk.totalBytes);
  // A filesystem whose size the agent could not read is not a filesystem known to be full.
  if (percent === null) return null;
  if (percent >= DISK_CRITICAL_PERCENT) return { kind: 'disk_full', level: 'critical', subject: disk.mount, percent };
  if (percent >= DISK_WARNING_PERCENT) return { kind: 'disk_nearly_full', level: 'warning', subject: disk.mount, percent };
  return null;
}

/**
 * Every finding for one host, worst first.
 *
 * A host that has stopped reporting produces exactly one finding and nothing else: its last reading is
 * however old the silence is, and listing "disk 91% full" beside it would present a stale figure as a
 * current one. A host that has never reported produces none — there is nothing to have found.
 */
/**
 * What Redis says about itself, judged only where the figures allow it.
 *
 * Three things, and deliberately not a fourth. `evictedKeys` is a counter since Redis started, so a
 * number above zero says it evicted *at some point*, not that it is evicting now — and OpsWatch keeps
 * no previous value to turn it into a rate. Reporting it would be a figure that looks like a problem
 * and is not one, which is worse than silence.
 */
function redisFindings(host: Host): HostFinding[] {
  const redis = host.redis;
  if (redis === null) return [];
  const findings: HostFinding[] = [];
  const name = 'Redis';

  // Redis told us its last background save failed. No inference, no threshold: it said so.
  if (redis.lastSaveOk === false) {
    findings.push({ kind: 'redis_last_save_failed', level: 'warning', subject: name, percent: null });
  }

  const used = redis.usedMemoryBytes;
  const limit = redis.maxMemoryBytes;
  if (used !== null && limit !== null && limit > 0) {
    const percent = (used / limit) * 100;
    if (percent >= REDIS_LIMIT_WARNING_PERCENT) {
      findings.push({ kind: 'redis_near_memory_limit', level: 'warning', subject: name, percent });
    }
  } else if (used !== null && host.latest?.memoryTotalBytes != null && host.latest.memoryTotalBytes > 0) {
    // No limit set. Only worth saying once Redis is a large enough share of the machine that the
    // machine's own memory becoming the ceiling is a real prospect rather than a theoretical one.
    const share = (used / host.latest.memoryTotalBytes) * 100;
    if (share >= REDIS_SHARE_WARNING_PERCENT) {
      findings.push({ kind: 'redis_no_memory_limit', level: 'warning', subject: name, percent: share });
    }
  }
  return findings;
}

export function hostFindings(host: Host): HostFinding[] {
  if (host.state === 'stale') {
    return [{ kind: 'stopped_reporting', level: 'critical', subject: host.name, percent: null }];
  }
  if (host.latest === null) return [];

  const findings = host.latest.disks.flatMap((disk) => diskFinding(disk) ?? []);
  findings.push(...redisFindings(host));
  const memory = percentOf(host.latest.memoryUsedBytes, host.latest.memoryTotalBytes);
  if (memory !== null && memory >= MEMORY_WARNING_PERCENT) {
    findings.push({ kind: 'memory_nearly_exhausted', level: 'warning', subject: host.name, percent: memory });
  }

  // Worst first, then by how bad: an operator scanning a list reads the top of it.
  return findings.sort((a, b) => (a.level === b.level ? (b.percent ?? 0) - (a.percent ?? 0) : a.level === 'critical' ? -1 : 1));
}

/** The worst level across a host's findings, or null when it has none. What a list renders as a dot. */
export function worstFinding(findings: readonly HostFinding[]): HostFindingLevel | null {
  if (findings.some((one) => one.level === 'critical')) return 'critical';
  return findings.length > 0 ? 'warning' : null;
}
