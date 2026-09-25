import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';

/**
 * No message key may ever reach a reader.
 *
 * next-intl does not throw for a missing message — it renders the key path — so a lookup that misses is
 * not an error anywhere, it is `Monitoring.report.figure.opened.critical` printed onto a page somebody
 * is using. It has happened twice in this product: once on the alarms list, once on every report page.
 *
 * Two guards, because the two failures had different shapes:
 *
 *   1. **No key may contain a dot.** next-intl reads a dot as a path separator, so a flat key written
 *      `"opened.critical"` can never be found — `t('figure.opened.critical')` looks for a child of the
 *      string at `figure.opened`. This is what produced the report failure, and it is invisible to every
 *      other test because the catalogue itself is perfectly valid JSON.
 *   2. **Both locales carry the same keys.** A key present in English and missing in French renders as
 *      its own path to a French reader, and only to a French reader.
 *
 * The browser suite has the third guard: a sweep that fails if anything shaped like a key appears in the
 * rendered text of any page. Between them, a key has nowhere left to hide.
 */

type Tree = { [key: string]: string | Tree };

function walk(tree: Tree, path: string[] = []): { path: string; key: string }[] {
  const found: { path: string; key: string }[] = [];
  for (const [key, value] of Object.entries(tree)) {
    const here = [...path, key];
    if (key.includes('.')) found.push({ path: here.join('.'), key });
    if (typeof value === 'object' && value !== null) found.push(...walk(value as Tree, here));
  }
  return found;
}

function keysOf(tree: Tree, path = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const here = path === '' ? key : `${path}.${key}`;
    return typeof value === 'string' ? [here] : keysOf(value as Tree, here);
  });
}

describe('THE RULING: a message key can never be rendered as text', () => {
  it.each([['en', en], ['fr', fr]] as const)('%s has no key containing a dot', (locale, messages) => {
    // `"opened.critical"` inside `figure` is unreachable: next-intl looks for `figure` → `opened` →
    // `critical`, finds a string at `figure.opened`, and renders the whole path onto the page instead.
    const offenders = walk(messages as unknown as Tree);
    expect(offenders.map((one) => one.path), `${locale} has unreachable keys`).toEqual([]);
  });

  it('THE RULING: every English key exists in French, and the reverse', () => {
    // A key present in one locale only renders as its own path — and only to the readers of the other.
    const english = new Set(keysOf(en as unknown as Tree));
    const french = new Set(keysOf(fr as unknown as Tree));
    expect([...english].filter((key) => !french.has(key))).toEqual([]);
    expect([...french].filter((key) => !english.has(key))).toEqual([]);
  });

  it('has no empty message, which renders as a blank where a sentence was meant to be', () => {
    for (const [locale, messages] of [['en', en], ['fr', fr]] as const) {
      const blank = keysOf(messages as unknown as Tree).filter((key) => {
        const value = key.split('.').reduce<unknown>((node, part) => (node as Tree)?.[part], messages);
        return typeof value === 'string' && value.trim() === '';
      });
      expect(blank, `${locale}`).toEqual([]);
    }
  });
});
