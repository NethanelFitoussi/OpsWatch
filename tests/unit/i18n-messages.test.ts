import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { causesFor } from '@/lib/detect/explain';
import { HEADLINE_KINDS } from '@/lib/monitoring/shared/duration';
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

/** Every kind a page can headline, which is exactly the set whose causes a reader can reach. */
const HEADLINE_KINDS_FOR_CAUSES = [...HEADLINE_KINDS];

describe('the causes a problem page offers', () => {
  const enFlat = flatten(en as Tree);
  const frFlat = flatten(fr as Tree);

  it('THE RULING: every cause id a detector family names has a sentence in both locales', () => {
    // A missing one renders its own id at a reader — the failure `synthetic_down` already taught us —
    // and the ids live in a pure module, so nothing else would notice.
    const ids = new Set(HEADLINE_KINDS_FOR_CAUSES.flatMap((kind) => [...causesFor(kind)]));
    expect(ids.size).toBeGreaterThan(0);
    for (const id of ids) {
      expect(enFlat[`Monitoring.diagnosis.causeList.${id}`], id).toBeTypeOf('string');
      expect(frFlat[`Monitoring.diagnosis.causeList.${id}`], id).toBeTypeOf('string');
    }
  });

  it('carries no sentence nobody asks for, so the catalogue cannot quietly grow a dead entry', () => {
    const used = new Set(HEADLINE_KINDS_FOR_CAUSES.flatMap((kind) => [...causesFor(kind)]));
    const listed = Object.keys(enFlat)
      .filter((key) => key.startsWith('Monitoring.diagnosis.causeList.'))
      .map((key) => key.slice('Monitoring.diagnosis.causeList.'.length));
    expect(listed.filter((id) => !used.has(id))).toEqual([]);
  });

  it('gives every unit the rule panel can render a way to say itself', () => {
    for (const unit of ['percent', 'ms', 'days', 'rate']) {
      expect(enFlat[`Monitoring.diagnosis.${unit}`], unit).toBeTypeOf('string');
      expect(frFlat[`Monitoring.diagnosis.${unit}`], unit).toBeTypeOf('string');
    }
  });
});

/**
 * Every literal message key a component asks for, resolved against the namespace it asked in.
 *
 * `const t = await getTranslations('Monitoring.estate')` followed by `t('verdict.healthy')` is a promise
 * that `Monitoring.estate.verdict.healthy` exists. Nothing checked that promise, and the cost of breaking
 * it is a raw key rendered at a reader — which is how `Insights.messages.synthetic_down` reached a screen,
 * and how a whole namespace was once replaced wholesale without a single test noticing.
 *
 * Only literal keys in files with a literal namespace are resolved: a key built at runtime cannot be
 * checked here, and pretending otherwise would mean guessing.
 */
function requestedKeys(): { file: string; key: string }[] {
  const asked: { file: string; key: string }[] = [];
  for (const file of [...sourceFilesUnder('components'), ...sourceFilesUnder('app'), ...sourceFilesUnder('lib')]) {
    const source = readFileSync(file, 'utf8');
    // Translator variable -> namespace, for the namespaces written out in full. A name bound twice in one
    // file is one component's `t` and another's; without scope analysis it cannot be resolved, so it is
    // dropped rather than guessed at.
    const bindings = new Map<string, Set<string>>();
    for (const [, name, namespace] of source.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:get|use)Translations\(\s*'([\w.]+)'\s*\)/g)) {
      (bindings.get(name) ?? bindings.set(name, new Set()).get(name)!).add(namespace);
    }
    const namespaces = new Map([...bindings].filter(([, set]) => set.size === 1).map(([name, set]) => [name, [...set][0]]));
    if (namespaces.size === 0) continue;
    for (const [name, namespace] of namespaces) {
      // `t('a.b')` and `t('a.b', { … })`, never `t(\`a.${x}\`)`.
      for (const [, key] of source.matchAll(new RegExp(`\\b${name}\\(\\s*'([\\w.]+)'`, 'g'))) {
        asked.push({ file, key: `${namespace}.${key}` });
      }
    }
  }
  return asked;
}

describe('the keys the product actually asks for', () => {
  it('THE RULING: every literal key a component reads exists in English and in French', () => {
    const enFlat = flatten(en as Tree);
    const frFlat = flatten(fr as Tree);
    const asked = requestedKeys();
    // A guard that resolves nothing would pass for ever; this is the tripwire on the tripwire.
    expect(asked.length).toBeGreaterThan(200);

    const missing = asked.filter(({ key }) => typeof enFlat[key] !== 'string' || typeof frFlat[key] !== 'string');
    expect(missing.map(({ file, key }) => `${key} (${file})`)).toEqual([]);
  });
});
