import { describe, expect, it } from 'vitest';
import { columnClass } from '@/components/analysis/dense-table';

describe('columnClass', () => {
  it('drops the least important columns first as the screen narrows', () => {
    expect(columnClass('always')).toBe('');
    expect(columnClass(undefined)).toBe('');
    expect(columnClass('sm')).toBe('hidden sm:table-cell');
    expect(columnClass('md')).toBe('hidden md:table-cell');
    expect(columnClass('lg')).toBe('hidden lg:table-cell');
  });
});
