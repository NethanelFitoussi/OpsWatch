import type { SearchResult } from '@/api/contract';
import { addRecentSearch, MAX_RECENT_SEARCHES } from '@/state/settings';
import { groupSearchResults, isSearchable } from '../helpers';

const r = (type: SearchResult['type'], id: string): SearchResult => ({ type, id, title: id });

describe('groupSearchResults', () => {
  it('groups by type in the fixed display order and keeps the server order inside a group', () => {
    const groups = groupSearchResults([r('alert', 'a1'), r('service', 's1'), r('problem', 'p1'), r('infrastructure', 'i1'), r('problem', 'p2'), r('incident', 'n1'), r('error', 'e1')]);
    expect(groups.map((g) => g.key)).toEqual(['problem', 'error', 'service', 'infrastructure', 'alert', 'incident']);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['p1', 'p2']);
  });

  it('puts unexpected types last under "other" and drops empty groups', () => {
    const groups = groupSearchResults([r('slo', 'x'), r('service', 's1'), r('deployment', 'd1')]);
    expect(groups.map((g) => g.key)).toEqual(['service', 'other']);
    expect(groups[1]!.items.map((i) => i.id)).toEqual(['x', 'd1']);
  });

  it('returns nothing for no results', () => {
    expect(groupSearchResults([])).toEqual([]);
  });
});

describe('isSearchable', () => {
  it('needs at least two non-space characters', () => {
    expect(isSearchable('')).toBe(false);
    expect(isSearchable(' a ')).toBe(false);
    expect(isSearchable('ab')).toBe(true);
  });
});

describe('recent searches', () => {
  it('puts the newest first, de-duplicates case-insensitively and caps the list', () => {
    let list: string[] = [];
    list = addRecentSearch(list, 'checkout');
    list = addRecentSearch(list, 'redis');
    list = addRecentSearch(list, ' Checkout ');
    expect(list).toEqual(['Checkout', 'redis']);
    for (let i = 0; i < 20; i += 1) list = addRecentSearch(list, `q${i}`);
    expect(list).toHaveLength(MAX_RECENT_SEARCHES);
    expect(addRecentSearch(['a'], '   ')).toEqual(['a']);
  });
});
