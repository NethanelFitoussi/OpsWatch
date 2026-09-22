import { describe, expect, it } from 'vitest';
import {
  FLEET_EXPAND_CYCLES,
  FLEET_MIN_MEMBERS,
  fleetKey,
  planFleet,
  type FleetGroup,
  type FleetInput,
  type FleetTransition,
  type OpenFleet,
} from '@/lib/detect/fleet';
import { problemKey } from '@/lib/detect/key';

const NOW = Date.UTC(2026, 8, 19, 9, 0, 0);
const CONNECTION = 'c1';
const SCOPE = 'us-east-1';
const CLUSTER = 'prod';
const KIND = 'ecs_cpu_high';

const problems = (count: number) => Array.from({ length: count }, (_, i) => `p${i}`);

const openFleet = (over: Partial<OpenFleet> = {}): OpenFleet => ({
  id: 'fleet-1',
  key: fleetKey(CONNECTION, SCOPE, KIND, CLUSTER),
  clusterId: CLUSTER,
  kind: KIND,
  memberIds: problems(FLEET_MIN_MEMBERS),
  belowCycles: 0,
  ...over,
});

const plan = (over: Partial<FleetInput> = {}): FleetTransition[] =>
  planFleet({ connectionId: CONNECTION, scope: SCOPE, groups: [], open: [], nowMs: NOW, ...over });

const group = (breaching: string[]): FleetGroup => ({ clusterId: CLUSTER, kind: KIND, breaching });

describe('collapsing a fleet', () => {
  it('holds the boundaries §33.8 and D3 fix, as literals', () => {
    // Derived from the constant, every boundary test below would follow a change to it and prove nothing.
    // "More than three services of one cluster" is the spec's wording; four is the first count that collapses.
    expect(FLEET_MIN_MEMBERS).toBe(4);
    expect(FLEET_EXPAND_CYCLES).toBe(2);
  });

  it('does nothing at one, two or three services breaching', () => {
    for (const count of [1, 2, 3]) {
      expect(plan({ groups: [group(problems(count))] }), `${count} breaching`).toEqual([]);
    }
  });

  it('collapses on the fourth, which is the boundary §33.8 names', () => {
    const [transition] = plan({ groups: [group(problems(4))] });
    expect(transition).toMatchObject({ type: 'fleet_open', clusterId: CLUSTER, kind: KIND, at: NOW });
    expect((transition as { memberIds: string[] }).memberIds).toHaveLength(4);
  });

  it('keys the fleet on the cluster, so it cannot collide with any per-service problem', () => {
    const key = fleetKey(CONNECTION, SCOPE, KIND, CLUSTER);
    expect(key).toBe(problemKey({ connectionId: CONNECTION, scope: SCOPE, kind: KIND, subjectId: CLUSTER }));
    for (const service of ['prod/web', 'prod/api', CLUSTER + '/x']) {
      expect(key).not.toBe(problemKey({ connectionId: CONNECTION, scope: SCOPE, kind: KIND, subjectId: service }));
    }
  });

  it('does not open a second fleet for one already collapsed', () => {
    expect(plan({ groups: [group(problems(FLEET_MIN_MEMBERS))], open: [openFleet()] })).toEqual([]);
  });

  it('collapses each cluster and each detector separately', () => {
    const transitions = plan({
      groups: [
        group(problems(FLEET_MIN_MEMBERS)),
        { clusterId: 'staging', kind: KIND, breaching: problems(FLEET_MIN_MEMBERS) },
        { clusterId: CLUSTER, kind: 'ecs_memory_high', breaching: problems(FLEET_MIN_MEMBERS) },
      ],
    });
    expect(transitions).toHaveLength(3);
    expect(new Set(transitions.map((t) => (t as { key: string }).key)).size).toBe(3);
  });
});

describe('membership while a fleet is open', () => {
  it('reports a service that joins a cluster-wide outage late', () => {
    const [transition] = plan({
      groups: [group([...problems(FLEET_MIN_MEMBERS), 'p9'])],
      open: [openFleet()],
    });
    expect(transition).toMatchObject({ type: 'fleet_members', id: 'fleet-1', joined: ['p9'], left: [] });
  });

  it('reports one that leaves while the fleet stays collapsed', () => {
    const [transition] = plan({
      groups: [group([...problems(FLEET_MIN_MEMBERS), 'p9'].filter((id) => id !== 'p0'))],
      open: [openFleet({ memberIds: [...problems(FLEET_MIN_MEMBERS), 'p9'] })],
    });
    expect(transition).toMatchObject({ type: 'fleet_members', left: ['p0'], joined: [] });
  });

  it('clears a below-threshold streak as soon as the count recovers', () => {
    const [transition] = plan({ groups: [group(problems(FLEET_MIN_MEMBERS))], open: [openFleet({ belowCycles: 1 })] });
    // The fleet was one cycle from expanding; recovering must put it back to a full count, not leave it primed.
    expect(transition).toMatchObject({ type: 'fleet_members', memberIds: problems(FLEET_MIN_MEMBERS) });
  });
});

describe('expanding, with hysteresis', () => {
  it('holds on the first cycle below the threshold rather than expanding at once', () => {
    const [transition] = plan({ groups: [group(problems(FLEET_MIN_MEMBERS - 1))], open: [openFleet()] });
    expect(transition).toMatchObject({ type: 'fleet_hold', id: 'fleet-1', belowCycles: 1 });
  });

  it('expands on the second consecutive cycle below it', () => {
    const [transition] = plan({
      groups: [group(problems(FLEET_MIN_MEMBERS - 1))],
      open: [openFleet({ belowCycles: FLEET_EXPAND_CYCLES - 1 })],
    });
    expect(transition).toMatchObject({ type: 'fleet_resolve', id: 'fleet-1', at: NOW });
  });

  it('does not flap when the count oscillates around the boundary', () => {
    // Three, then four, then three: the fleet must still be collapsed, because the streak was broken.
    let fleet = openFleet();
    const first = plan({ groups: [group(problems(3))], open: [fleet] })[0];
    expect(first).toMatchObject({ type: 'fleet_hold', belowCycles: 1 });

    fleet = openFleet({ belowCycles: 1 });
    const recovered = plan({ groups: [group(problems(FLEET_MIN_MEMBERS))], open: [fleet] })[0];
    expect(recovered.type).toBe('fleet_members');

    // The store reset belowCycles on the recovery, so the next dip starts the count again rather than finishing it.
    const dipAgain = plan({ groups: [group(problems(3))], open: [openFleet({ belowCycles: 0 })] })[0];
    expect(dipAgain).toMatchObject({ type: 'fleet_hold', belowCycles: 1 });
  });

  it('expands a fleet whose group vanished entirely, rather than leaving it collapsed for ever', () => {
    // Every member resolved, so the store reports no group at all for that cluster and detector.
    const [transition] = plan({ groups: [], open: [openFleet({ belowCycles: FLEET_EXPAND_CYCLES - 1 })] });
    expect(transition).toMatchObject({ type: 'fleet_resolve', id: 'fleet-1' });
  });

  it('holds a vanished group for one cycle too, so a capped cycle does not expand it', () => {
    const [transition] = plan({ groups: [], open: [openFleet()] });
    expect(transition).toMatchObject({ type: 'fleet_hold', belowCycles: 1 });
  });

  it('hands back every child it ever held when it expands', () => {
    // The children were never closed, so un-grouping returns them with firstSeenAt, occurrences and any
    // acknowledgement intact — which is the whole reason §33.8 made this a transition rather than rendering.
    const [transition] = plan({
      groups: [group(['p1'])],
      open: [openFleet({ memberIds: ['p0', 'p1', 'p2', 'p3'], belowCycles: FLEET_EXPAND_CYCLES - 1 })],
    });
    expect(transition).toMatchObject({ type: 'fleet_resolve', memberIds: ['p0', 'p1', 'p2', 'p3'] });
  });
});

describe('the whole plan', () => {
  it('is pure: the same input twice gives the same transitions', () => {
    const input = { groups: [group(problems(FLEET_MIN_MEMBERS))], open: [] };
    expect(plan(input)).toEqual(plan(input));
  });

  it('does nothing at all when nothing is breaching and nothing is collapsed', () => {
    expect(plan()).toEqual([]);
  });
});
