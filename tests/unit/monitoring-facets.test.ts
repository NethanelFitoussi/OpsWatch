import { describe, expect, it } from 'vitest';
import { applyFacets, clearFacetsQuery, countFacets, isFacetSelected, parseFacetSelection, toggleFacetQuery } from '@/lib/monitoring/shared/facets';

type Row = { name: string; engine: string; role: string; pi: boolean };
const rows: Row[] = [
  { name: 'a', engine: 'mysql', role: 'writer', pi: true },
  { name: 'b', engine: 'mysql', role: 'reader', pi: false },
  { name: 'c', engine: 'aurora-postgresql', role: 'writer', pi: true },
  { name: 'd', engine: 'aurora-postgresql', role: 'reader', pi: false },
];
const accessors = { engine: (r: Row) => r.engine, role: (r: Row) => r.role, pi: (r: Row) => (r.pi ? 'on' : 'off') };

describe('countFacets', () => {
  it('counts every value of every group, most frequent first then alphabetical', () => {
    expect(countFacets(rows, accessors)).toEqual([
      { id: 'engine', values: [{ value: 'aurora-postgresql', count: 2 }, { value: 'mysql', count: 2 }] },
      { id: 'role', values: [{ value: 'reader', count: 2 }, { value: 'writer', count: 2 }] },
      { id: 'pi', values: [{ value: 'off', count: 2 }, { value: 'on', count: 2 }] },
    ]);
  });
  it('skips items whose accessor returns null and drops a group with no value', () => {
    expect(countFacets([{ name: 'a', engine: 'mysql', role: 'writer', pi: true }], { cluster: () => null })).toEqual([]);
  });
  it('orders by count before name', () => {
    const many = [...rows, { name: 'e', engine: 'mysql', role: 'writer', pi: true }];
    expect(countFacets(many, { engine: (r: Row) => r.engine })[0].values).toEqual([
      { value: 'mysql', count: 3 }, { value: 'aurora-postgresql', count: 2 },
    ]);
  });
});

describe('parseFacetSelection', () => {
  it('reads only the known groups, deduplicates and bounds each value', () => {
    expect(parseFacetSelection({ engine: ['mysql', 'mysql'], role: 'writer', other: 'x' }, ['engine', 'role'])).toEqual({ engine: ['mysql'], role: ['writer'] });
    expect(parseFacetSelection({ engine: 'x'.repeat(60) }, ['engine']).engine[0]).toHaveLength(40);
    expect(parseFacetSelection({}, ['engine'])).toEqual({});
  });
});

describe('applyFacets', () => {
  it('ORs inside a group and ANDs across groups', () => {
    expect(applyFacets(rows, { engine: ['mysql'] }, accessors).map((r) => r.name)).toEqual(['a', 'b']);
    expect(applyFacets(rows, { engine: ['mysql', 'aurora-postgresql'] }, accessors).map((r) => r.name)).toEqual(['a', 'b', 'c', 'd']);
    expect(applyFacets(rows, { engine: ['mysql'], role: ['writer'] }, accessors).map((r) => r.name)).toEqual(['a']);
  });
  it('keeps everything when nothing is selected, and excludes null values of a selected group', () => {
    expect(applyFacets(rows, {}, accessors)).toHaveLength(4);
    expect(applyFacets(rows, { cluster: ['x'] }, { cluster: () => null })).toEqual([]);
  });
});

describe('the URL round trip', () => {
  it('adds, removes and clears values while keeping the rest of the query', () => {
    expect(toggleFacetQuery('range=12h&engine=mysql', 'engine', 'aurora-postgresql', true)).toBe('range=12h&engine=mysql&engine=aurora-postgresql');
    expect(toggleFacetQuery('range=12h&engine=mysql&engine=x', 'engine', 'mysql', false)).toBe('range=12h&engine=x');
    expect(toggleFacetQuery('range=12h&engine=mysql', 'engine', 'mysql', true)).toBe('range=12h&engine=mysql');
    expect(clearFacetsQuery('range=12h&engine=mysql&role=writer&sort=cpu', ['engine', 'role'])).toBe('range=12h&sort=cpu');
  });
  it('tells whether a value is selected', () => {
    expect(isFacetSelected({ engine: ['mysql'] }, 'engine', 'mysql')).toBe(true);
    expect(isFacetSelected({ engine: ['mysql'] }, 'engine', 'x')).toBe(false);
    expect(isFacetSelected({}, 'engine', 'mysql')).toBe(false);
  });
});
