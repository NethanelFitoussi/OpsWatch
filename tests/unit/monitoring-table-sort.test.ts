import { describe, expect, it } from 'vitest';
import { nextDirection, parseSort, sortQuery, sortRows } from '@/lib/monitoring/shared/table-sort';

type Row = { name: string; cpu: number | null };
const rows: Row[] = [{ name: 'b', cpu: 10 }, { name: 'a', cpu: null }, { name: 'c', cpu: 40 }, { name: 'd', cpu: 10 }];
const accessors = { name: (r: Row) => r.name, cpu: (r: Row) => r.cpu };
const fallback = { column: 'name', direction: 'asc' } as const;

describe('parseSort', () => {
  it('reads "column:direction" and falls back on anything else', () => {
    expect(parseSort('cpu:desc', ['name', 'cpu'], fallback)).toEqual({ column: 'cpu', direction: 'desc' });
    expect(parseSort('cpu', ['name', 'cpu'], fallback)).toEqual({ column: 'cpu', direction: 'asc' });
    expect(parseSort('unknown:desc', ['name', 'cpu'], fallback)).toEqual(fallback);
    expect(parseSort(['cpu:desc', 'name:asc'], ['name', 'cpu'], fallback)).toEqual({ column: 'cpu', direction: 'desc' });
    expect(parseSort(undefined, ['name', 'cpu'], fallback)).toEqual(fallback);
  });
});

describe('sortRows', () => {
  it('sorts numbers, is stable for ties, and keeps nulls last in both directions', () => {
    expect(sortRows(rows, { column: 'cpu', direction: 'desc' }, accessors).map((r) => r.name)).toEqual(['c', 'b', 'd', 'a']);
    expect(sortRows(rows, { column: 'cpu', direction: 'asc' }, accessors).map((r) => r.name)).toEqual(['b', 'd', 'c', 'a']);
  });
  it('sorts strings with the English collator', () => {
    expect(sortRows(rows, { column: 'name', direction: 'asc' }, accessors).map((r) => r.name)).toEqual(['a', 'b', 'c', 'd']);
    expect(sortRows(rows, { column: 'name', direction: 'desc' }, accessors).map((r) => r.name)).toEqual(['d', 'c', 'b', 'a']);
  });
  it('returns the rows untouched when the column has no accessor', () => {
    expect(sortRows(rows, { column: 'nope', direction: 'asc' }, accessors)).toEqual(rows);
  });
});

describe('sortQuery and nextDirection', () => {
  it('a new column starts descending, the active column flips', () => {
    expect(nextDirection('cpu', { column: 'name', direction: 'asc' })).toBe('desc');
    expect(nextDirection('cpu', { column: 'cpu', direction: 'desc' })).toBe('asc');
    expect(sortQuery('range=12h&sort=name:asc', 'cpu', { column: 'name', direction: 'asc' })).toBe('range=12h&sort=cpu%3Adesc');
  });
});
