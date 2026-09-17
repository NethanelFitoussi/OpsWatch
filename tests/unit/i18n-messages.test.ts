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
});
