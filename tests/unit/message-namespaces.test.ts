import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';

/**
 * Every literal message a component asks for exists, in the namespace it asks from.
 *
 * `tests/unit/message-keys.test.ts` proves the catalogue is well formed and that both locales carry the
 * same keys. Neither guard says anything about the *call*: a key that is spelled correctly, present in
 * both locales and simply filed under the wrong namespace passes both, and next-intl then renders the
 * key path onto the page — `Monitoring.ec2.agentReports`, in front of an operator.
 *
 * It happened here: a string was moved between namespaces while splitting one catalogue edit from
 * another, and the only thing that would have caught it was the browser sweep, which had already run.
 * So this guard is static, runs with the unit suite, and needs nobody to remember to look.
 *
 * It reads the two shapes the codebase actually uses — `const x = useTranslations('NS')` and
 * `const x = await getTranslations('NS')` — and checks every `x('literal')` against the catalogue.
 * Anything composed at run time is skipped deliberately: those keys cannot be read from the source,
 * which is exactly why `report-message-keys.test.ts` builds real reports to reach them instead.
 */

const SRC = join(__dirname, '../../src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

function has(tree: unknown, path: string[]): boolean {
  let node: unknown = tree;
  for (const step of path) {
    if (typeof node !== 'object' || node === null || !(step in node)) return false;
    node = (node as Record<string, unknown>)[step];
  }
  return typeof node === 'string';
}

/** `const t = useTranslations('NS')`, `const t = await getTranslations('NS')`, and the `t.rich`/`t.has` forms. */
const BINDING = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*'([^']+)'\s*\)/g;

/** A call on one of those bindings with a literal key: `t('a.b')`, `t.rich('a.b', …)`, `t.has('a.b')`. */
const callsOf = (name: string) =>
  new RegExp(`\\b${name.replace(/\$/g, '\\$')}(?:\\.(?:rich|has|markup))?\\(\\s*'([^']+)'`, 'g');

type Lookup = { file: string; key: string };

function lookups(): Lookup[] {
  const found: Lookup[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    // A file often holds several components, each binding `t` to its own namespace. So a call belongs
    // to the nearest binding of that name above it, not to every binding in the file.
    const bindings = [...text.matchAll(BINDING)].map((match) => ({
      name: match[1],
      namespace: match[2],
      at: match.index ?? 0,
    }));
    for (const name of new Set(bindings.map((one) => one.name))) {
      const scopes = bindings.filter((one) => one.name === name);
      for (const call of text.matchAll(callsOf(name))) {
        const at = call.index ?? 0;
        const scope = [...scopes].reverse().find((one) => one.at < at);
        if (scope === undefined) continue; // the call sits above every binding: not one of ours.
        found.push({ file: file.slice(SRC.length + 1), key: `${scope.namespace}.${call[1]}` });
      }
    }
  }
  return found;
}

describe('a message asked for by name exists under the namespace it was asked from', () => {
  const all = lookups();

  it('reads enough of the source to be worth trusting', () => {
    // A regex that stopped matching would turn this whole guard green and silent.
    expect(all.length).toBeGreaterThan(500);
  });

  it('THE RULING: every literal lookup resolves in English', () => {
    const missing = all.filter((one) => !has(en, one.key.split('.')));
    expect(missing.map((one) => `${one.file}: ${one.key}`)).toEqual([]);
  });

  it('and in French, because a key renders as itself only to the reader whose locale is missing it', () => {
    const missing = all.filter((one) => !has(fr, one.key.split('.')));
    expect(missing.map((one) => `${one.file}: ${one.key}`)).toEqual([]);
  });
});
