import type { Change, Family, Health } from '@/api/contract';
import { actionVerdict, familyStatus, groupChanges, unavailableReason, unreadableFamilies } from '../helpers';

const change = (id: string, direction: Change['direction']): Change => ({ id, direction, text: id });
const counts = (critical: number, warning: number): Health['counts'] => ({ critical, warning, healthyServices: null, totalServices: null });

describe('actionVerdict', () => {
  it('says yes only for critical problems, and counts them in the singular', () => {
    expect(actionVerdict(counts(1, 4))).toEqual({ key: 'home.needAction.yes.one', params: { count: 1 } });
    expect(actionVerdict(counts(3, 0))).toEqual({ key: 'home.needAction.yes.other', params: { count: 3 } });
    expect(actionVerdict(counts(0, 2)).key).toBe('home.needAction.maybe');
    expect(actionVerdict(counts(0, 0)).key).toBe('home.needAction.no');
  });
});

describe('groupChanges', () => {
  it('groups by movement in briefing order, keeping the server order inside a group', () => {
    const groups = groupChanges([change('a', 'resolved'), change('b', 'new'), change('c', 'up'), change('d', 'up'), change('e', 'stable')]);
    expect(groups.map((group) => [group.direction, group.changes.map((c) => c.id)])).toEqual([
      ['new', ['b']],
      ['up', ['c', 'd']],
      ['resolved', ['a']],
      ['stable', ['e']],
    ]);
  });

  it('has nothing to show when nothing changed', () => {
    expect(groupChanges([])).toEqual([]);
  });
});

describe('coverage', () => {
  const unreadable: Family = { family: 'cloudfront', label: 'CDN', status: 'healthy', total: null, affected: null, unavailable: { reason: 'denied', code: 'AccessDenied' } };
  const containers: Family = { family: 'ecs', label: 'Containers', status: 'degraded', total: 9, affected: 1 };

  it('never presents a family OpsWatch could not read as healthy', () => {
    expect(familyStatus(unreadable)).toBe('unknown');
    expect(familyStatus(containers)).toBe('degraded');
  });

  it('lists the families that could not be read', () => {
    expect(unreadableFamilies([containers, unreadable]).map((family) => family.label)).toEqual(['CDN']);
    expect(unreadableFamilies([containers])).toEqual([]);
  });

  it('puts the reason before the machine code, and never repeats it', () => {
    expect(unavailableReason({ reason: 'denied', code: 'AccessDenied' })).toBe('denied (AccessDenied)');
    expect(unavailableReason({ reason: 'throttled' })).toBe('throttled');
    expect(unavailableReason({ reason: 'denied', code: 'denied' })).toBe('denied');
  });
});
