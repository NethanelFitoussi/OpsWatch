import type { Evidence } from '@/api/contract';
import { chronological, countByKind, visibleHighlights } from '../helpers';

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
