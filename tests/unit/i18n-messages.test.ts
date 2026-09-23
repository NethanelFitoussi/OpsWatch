import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sourceFilesUnder } from '../helpers/source-graph';
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

/**
 * Every `Insights.messages.x` key a detector or a producer names, found in the source rather than listed
 * here — a list would drift, and the failure it hides is silent: a title key with no message renders as the
 * raw key on the page, which is how `synthetic_down` reached a screen reading "Insights.messages.synthetic_down".
 */
function producedTitleKeys(): string[] {
  const keys = new Set<string>();
  for (const file of sourceFilesUnder('lib')) {
    // Quoted, so the prose in a comment about the key's shape is not mistaken for a key.
    for (const [, key] of readFileSync(file, 'utf8').matchAll(/'Insights\.messages\.([a-z0-9_]+)'/g)) keys.add(key);
  }
  return [...keys].sort();
}

describe('message catalogues', () => {
  const enKeys = flatten(en as Tree);
  const frKeys = flatten(fr as Tree);

  it('have exactly the same keys in English and French', () => {
    expect(Object.keys(frKeys).sort()).toEqual(Object.keys(enKeys).sort());
  });

  it('THE RULING: every title key a detector names has a message, in both languages', () => {
    const produced = producedTitleKeys();
    expect(produced.length).toBeGreaterThan(3);
    const missing = produced.filter((key) => enKeys[`Insights.messages.${key}`] === undefined || frKeys[`Insights.messages.${key}`] === undefined);
    // A missing one renders as the raw key on the page rather than failing anywhere a test would notice.
    expect(missing).toEqual([]);
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
