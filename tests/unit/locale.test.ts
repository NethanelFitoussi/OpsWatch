import { describe, expect, it } from 'vitest';
import { resolveLocale } from '@/i18n/routing';

describe('resolveLocale', () => {
  it('keeps a supported locale and falls back to English otherwise', () => {
    expect(resolveLocale('fr')).toBe('fr');
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('de')).toBe('en');
    expect(resolveLocale('//evil.example')).toBe('en');
    expect(resolveLocale(undefined)).toBe('en');
  });
});
