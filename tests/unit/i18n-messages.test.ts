import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      acc[path] = value;
    } else {
      Object.assign(acc, flatten(value, path));
    }
    return acc;
  }, {});
}

/** The `{name}` placeholders a message interpolates, order-independent. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

describe('message catalogues', () => {
  const enKeys = flatten(en as Tree);
  const frKeys = flatten(fr as Tree);

  it('have exactly the same keys in English and French', () => {
    expect(Object.keys(frKeys).sort()).toEqual(Object.keys(enKeys).sort());
  });

  it('have no empty strings', () => {
    for (const [key, value] of Object.entries({ ...enKeys, ...frKeys })) {
      expect(value.trim(), key).not.toBe('');
    }
  });

  it('use the same placeholders in English and French for every change and window message', () => {
    // A translated template is free to reorder or drop grammatical agreement around a placeholder (the
    // French change templates do, to avoid agreeing with {window}'s gender), but it must still interpolate
    // the same variables the caller supplies.
    const prefixes = ['Monitoring.common.change.', 'Monitoring.common.window.'];
    for (const key of Object.keys(enKeys)) {
      if (!prefixes.some((prefix) => key.startsWith(prefix))) continue;
      expect(placeholders(frKeys[key]), key).toEqual(placeholders(enKeys[key]));
    }
  });

  it('let the Overview caption name both evaluation windows, in both languages', () => {
    // The rules evaluate 15 minutes, except the task counts, which evaluate 10: the caption must say so
    // from the rule constants rather than spell one number out.
    for (const keys of [enKeys, frKeys]) {
      for (const key of ['Monitoring.overview.summary.window', 'Monitoring.overview.insights.description']) {
        expect(keys[key], key).toContain('{minutes}');
        expect(keys[key], key).toContain('{taskMinutes}');
        expect(keys[key], key).not.toMatch(/\b(10|15)\b/);
      }
    }
  });
});
