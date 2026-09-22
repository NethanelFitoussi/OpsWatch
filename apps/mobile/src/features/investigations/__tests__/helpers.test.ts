import type { Evidence } from '@/api/contract';
import { chronological, countByKind, splitPath, visibleHighlights, withDayBreaks } from '../helpers';

const item = (id: string, at: number, kind: Evidence['kind']): Evidence => ({ id, at, kind, type: 'metric', title: id });

describe('chronological', () => {
  it('orders by time, then facts before correlations before hypotheses, without mutating the input', () => {
    const input = [item('h', 10, 'hypothesis'), item('f2', 20, 'fact'), item('c', 10, 'correlation'), item('f1', 10, 'fact')];
    expect(chronological(input).map((e) => e.id)).toEqual(['f1', 'c', 'h', 'f2']);
    expect(input[0]!.id).toBe('h');
  });

  it('counts items by kind', () => {
    expect(countByKind([item('a', 0, 'fact'), item('b', 0, 'fact'), item('c', 0, 'hypothesis')])).toEqual({ fact: 2, correlation: 0, hypothesis: 1 });
  });
});

describe('visibleHighlights', () => {
  it('keeps only highlighted lines the snippet shows', () => {
    expect(visibleHighlights({ startLine: 41, code: ['a', 'b', 'c'], highlight: [40, 41, 43, 44] })).toEqual([41, 43]);
  });
});

describe('withDayBreaks', () => {
  const dayOf = (at: number) => (at < 100 ? 'Mon' : 'Tue');

  it('puts the items in time order and labels only the first item of each day', () => {
    const rows = withDayBreaks([item('c', 150, 'fact'), item('a', 10, 'fact'), item('b', 20, 'fact'), item('d', 160, 'fact')], dayOf);
    expect(rows.map((row) => [row.item.id, row.day])).toEqual([
      ['a', 'Mon'],
      ['b', null],
      ['c', 'Tue'],
      ['d', null],
    ]);
  });
});

describe('splitPath', () => {
  it('lets the file name lead a long path', () => {
    expect(splitPath('src/pricing/cart-pricing.ts')).toEqual({ directory: 'src/pricing/', name: 'cart-pricing.ts' });
    expect(splitPath('README.md')).toEqual({ directory: null, name: 'README.md' });
    expect(splitPath('src/')).toEqual({ directory: null, name: 'src/' });
  });
});
