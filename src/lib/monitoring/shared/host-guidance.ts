import type { Host } from '@opswatch/contract';
import type { HostFinding, HostFindingKind } from './host-findings';

/**
 * What to check when a machine is in trouble.
 *
 * The same rule as `metric-catalogue.ts`, for the same reason: **deterministic, never generated**. The
 * words are written once, in the message catalogue, and are identical every time. A model paraphrasing
 * "the disk is nearly full" differently on each render would be worse than saying nothing, because an
 * operator cannot learn a page that changes underneath them.
 *
 * And it says what to *check*, never what is wrong. OpsWatch reads one figure from one machine; it does
 * not know why the disk filled. "Check whether a log file is growing" is a step somebody can take. "A
 * log file is growing" would be a guess dressed as a finding.
 *
 * Pure: a finding and the host it came from in, identifiers out. It reads the host only to leave out
 * steps that cannot apply — there is no point telling somebody to look at Redis on a machine where the
 * agent found no Redis, and a list padded with irrelevant steps is a list nobody reads to the end.
 */

export type HostGuidance = {
  /** The message key under `Hosts.guidance`, and the id a test pins. */
  id: HostFindingKind;
  /** How many general steps this finding has, so the renderer asks for exactly those. */
  checks: number;
  /** Extra steps that apply only because of what the agent found running. */
  services: readonly ('redis' | 'docker')[];
};

const BASE: Record<HostFindingKind, number> = {
  disk_full: 5,
  disk_nearly_full: 5,
  memory_nearly_exhausted: 4,
  stopped_reporting: 4,
};

/** Which discovered services add a step to which finding, and nothing beyond what was actually found. */
const SERVICE_STEPS: Partial<Record<HostFindingKind, readonly ('redis' | 'docker')[]>> = {
  disk_full: ['redis', 'docker'],
  disk_nearly_full: ['redis', 'docker'],
  // Redis is the usual reason a box runs out of memory when nothing else changed.
  memory_nearly_exhausted: ['redis'],
};

export function hostGuidance(finding: HostFinding, host: Host): HostGuidance {
  const running = new Set(host.services.map((service) => service.kind));
  return {
    id: finding.kind,
    checks: BASE[finding.kind],
    services: (SERVICE_STEPS[finding.kind] ?? []).filter((kind) => running.has(kind)),
  };
}
