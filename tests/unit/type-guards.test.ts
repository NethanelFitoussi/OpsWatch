import { describe, expect, it } from 'vitest';
import { isOneOf } from '@/lib/type-guards';

describe('isOneOf', () => {
  it('accepts only members of the list', () => {
    const list = ['en', 'fr'] as const;
    expect(isOneOf(list, 'fr')).toBe(true);
    expect(isOneOf(list, 'de')).toBe(false);
    expect(isOneOf(list, undefined)).toBe(false);
  });
});
