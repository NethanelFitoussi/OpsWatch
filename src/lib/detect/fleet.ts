import 'server-only';
import { problemKey } from './key';

/**
 * Fleet collapse (§5's amendment 8, as ruled on by **§33.8**).
 *
 * When four services of one cluster breach the same detector, that is one cluster-wide problem, not four
 * service problems — and showing four rows buries the fact that the cluster is the subject.
 *
 * §33.8's ruling is the important part: collapse and expansion are **lifecycle transitions, not rendering**.
 * The children are linked and marked grouped, never resolved, so they keep accruing evidence and keep their
 * `firstSeenAt`, their occurrence counts and their acknowledgements. A fleet that expands therefore hands back
 * children with their history intact, which a resolve-and-recreate approach would have thrown away.
 */
export const FLEET_MIN_MEMBERS = 4;
/** Expansion needs this many consecutive cycles below the threshold, so a fleet on the boundary cannot flap. */
export const FLEET_EXPAND_CYCLES = 2;

/** What the store found: the problems currently breaching one detector within one cluster. */
export type FleetGroup = {
  clusterId: string;
  kind: string;
  breaching: readonly string[];
};

export type OpenFleet = {
  id: string;
  key: string;
  clusterId: string;
  kind: string;
  memberIds: readonly string[];
  /** How many consecutive cycles this fleet has been below the threshold. */
  belowCycles: number;
};

export type FleetTransition =
  | { type: 'fleet_open'; key: string; clusterId: string; kind: string; at: number; memberIds: string[] }
  | { type: 'fleet_members'; id: string; at: number; memberIds: string[]; joined: string[]; left: string[] }
  | { type: 'fleet_hold'; id: string; belowCycles: number }
  | { type: 'fleet_resolve'; id: string; at: number; memberIds: string[] };

export type FleetInput = {
  connectionId: string;
  scope: string;
  groups: readonly FleetGroup[];
  open: readonly OpenFleet[];
  nowMs: number;
};

const groupKey = (clusterId: string, kind: string) => `${kind}\u0000${clusterId}`;

/**
 * The fleet key is an ordinary problem key whose subject is the **cluster**. Nothing special is needed to keep
 * it from colliding with a per-service key: the subject id differs, and the subject id is in the digest.
 */
export function fleetKey(connectionId: string, scope: string, kind: string, clusterId: string): string {
  return problemKey({ connectionId, scope, kind, subjectId: clusterId });
}

export function planFleet(input: FleetInput): FleetTransition[] {
  const open = new Map(input.open.map((fleet) => [groupKey(fleet.clusterId, fleet.kind), fleet]));
  const transitions: FleetTransition[] = [];
  const seen = new Set<string>();

  for (const group of input.groups) {
    const id = groupKey(group.clusterId, group.kind);
    seen.add(id);
    const fleet = open.get(id);
    const members = [...group.breaching].sort();

    if (members.length >= FLEET_MIN_MEMBERS) {
      if (!fleet) {
        transitions.push({
          type: 'fleet_open',
          key: fleetKey(input.connectionId, input.scope, group.kind, group.clusterId),
          clusterId: group.clusterId,
          kind: group.kind,
          at: input.nowMs,
          memberIds: members,
        });
        continue;
      }
      const held = [...fleet.memberIds].sort();
      const joined = members.filter((member) => !held.includes(member));
      const left = held.filter((member) => !members.includes(member));
      // A membership change is reported even when the count is unchanged: who is in the outage is the point.
      if (joined.length > 0 || left.length > 0 || fleet.belowCycles > 0) {
        transitions.push({ type: 'fleet_members', id: fleet.id, at: input.nowMs, memberIds: members, joined, left });
      }
      continue;
    }

    // Below the threshold. Nothing to do unless a fleet is currently collapsed.
    if (fleet) transitions.push(...expanding(fleet, members, input.nowMs));
  }

  // A fleet whose group vanished entirely — every member resolved — is below the threshold too.
  for (const fleet of input.open) {
    if (!seen.has(groupKey(fleet.clusterId, fleet.kind))) {
      transitions.push(...expanding(fleet, [], input.nowMs));
    }
  }
  return transitions;
}

/**
 * The hysteresis. One cycle below the threshold is not enough: a cluster hovering at three and four services
 * would otherwise collapse and expand on alternate cycles, which is exactly the flapping the collapse was
 * introduced to stop.
 */
function expanding(fleet: OpenFleet, members: string[], nowMs: number): FleetTransition[] {
  const belowCycles = fleet.belowCycles + 1;
  if (belowCycles >= FLEET_EXPAND_CYCLES) {
    // Un-grouping returns the children as they were: they were never closed, so nothing of theirs was lost.
    return [{ type: 'fleet_resolve', id: fleet.id, at: nowMs, memberIds: [...new Set([...fleet.memberIds, ...members])].sort() }];
  }
  return [{ type: 'fleet_hold', id: fleet.id, belowCycles }];
}
