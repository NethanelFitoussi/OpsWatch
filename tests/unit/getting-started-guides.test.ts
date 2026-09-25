import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';
import { GUIDED, GUIDE_CHAPTERS, guidePath, hasGuide, setupPath } from '@/lib/integrations/guides';
import { INTEGRATIONS, INTEGRATION_SPECS } from '@/lib/integrations/catalogue';

/**
 * The Get Started guides (§D).
 *
 * A guide is a promise about a journey, so the failures worth guarding are structural: a card that leads
 * nowhere, a guide missing a section the others have, and copy that exists in one language only.
 */

const ROOT = join(import.meta.dirname, '../..');
const catalogue = (locale: typeof en) => (locale as unknown as Record<string, Record<string, unknown>>).GettingStarted;

describe('which integrations have a guide', () => {
  it('THE RULING: every guide lands on a page, and on a setup flow that exists', () => {
    for (const id of GUIDED) {
      const guide = join(ROOT, 'src/app/[locale]/getting-started', id, 'page.tsx');
      expect(() => readFileSync(guide, 'utf8'), id).not.toThrow();
      // And the action inside it goes where that provider is actually configured.
      expect(setupPath(id), id).toBe(INTEGRATION_SPECS[id].href);
      expect(guidePath(id)).toBe(`/getting-started/${id}`);
    }
  });

  it('THE RULING: Google has no guide, because it is authentication rather than something OpsWatch reads', () => {
    expect(hasGuide('google')).toBe(false);
    // Walking somebody towards a page that cannot configure it would be a dead end dressed as a step.
    expect([...GUIDED]).not.toContain('google');
  });

  it('only offers a guide for an integration this build can actually complete', () => {
    for (const id of GUIDED) expect(INTEGRATION_SPECS[id].available, id).toBe(true);
  });

  it('covers every connectable integration, so none is left without an explanation', () => {
    const connectable = INTEGRATIONS.filter((id) => INTEGRATION_SPECS[id].connectable);
    expect([...GUIDED].sort()).toEqual([...connectable].sort());
  });
});

describe('the copy each guide carries', () => {
  /** Every section the shared body renders. A guide missing one would render a raw key on the page. */
  const SECTIONS = ['unlocks', 'before', 'permissions', 'steps', 'states', 'failures', 'manage'] as const;
  const GUIDES = ['github', 'cloudflare', 'ai'] as const;

  it.each(GUIDES)('%s has every section the shared layout renders', (guide) => {
    const block = catalogue(en)[guide] as Record<string, unknown>;
    expect(block, guide).toBeDefined();
    for (const section of SECTIONS) expect(block[section], `${guide}.${section}`).toBeDefined();
    // And the chain diagram it is built around.
    expect(Object.keys(block.chain as object).length).toBeGreaterThanOrEqual(4);
  });

  it.each(GUIDES)('%s says what it unlocks, what it needs and what it may do — in both languages', (guide) => {
    for (const locale of [en, fr]) {
      const block = catalogue(locale as typeof en)[guide] as Record<string, Record<string, string>>;
      expect(block.unlocks.intro.length, guide).toBeGreaterThan(80);
      expect(block.before.needDetail.length, guide).toBeGreaterThan(40);
      expect(block.permissions.guaranteeDetail.length, guide).toBeGreaterThan(80);
      expect(block.manage.disconnectDetail.length, guide).toBeGreaterThan(80);
    }
  });

  it('THE RULING: each guide names only guarantees the implementation can prove', () => {
    const github = catalogue(en).github as Record<string, Record<string, string>>;
    // Asserted in `github-connection.test.ts` by reading the client's exports.
    expect(github.permissions.guaranteeDetail).toContain('no write request');

    const ai = catalogue(en).ai as Record<string, Record<string, string>>;
    // Asserted in `ai-ask.test.ts` against the system prompt and the evidence pack.
    expect(ai.permissions.guaranteeDetail).toContain('Never say one thing caused another');
    expect(ai.permissions.grantDetail).toContain('32 kB');

    const cloudflare = catalogue(en).cloudflare as Record<string, Record<string, string>>;
    // Asserted in `cloudflare-connection.test.ts`: seeing a zone is not watching it.
    expect(cloudflare.permissions.guaranteeDetail).toContain('does not put forty zones on a page');
  });

  it('the hub says what OpsWatch connects to, not what it requires', () => {
    const hub = catalogue(en).hub as Record<string, string>;
    expect(hub.title).toBe('Connect the systems you use');
    // Not "connect AWS to start using OpsWatch": AWS is one integration among several.
    expect(hub.intro).toContain('none of them is required');
  });
});

describe('a guide never shows a reader a message key', () => {
  /*
   * `IntegrationGuideBody` builds its keys at render — `steps.${id}.title`, `failures.${id}.fix`, and
   * a fixed set besides — which puts them out of reach of the guard that checks literal `t('…')`
   * lookups. next-intl does not throw for a missing message; it renders the key path. A new guide
   * spelled two of them differently and printed `GettingStarted.gcp.permissions.guaranteeTitle` onto
   * the page, and nothing failed until somebody measured the width of the paragraph it was in.
   */
  const FIXED = [
    'unlocks.title', 'unlocks.intro',
    'before.title', 'before.intro', 'before.needTerm', 'before.needDetail', 'before.costTerm', 'before.costDetail',
    'permissions.title', 'permissions.intro', 'permissions.grantTerm', 'permissions.grantDetail',
    'permissions.guaranteeTitle', 'permissions.guaranteeDetail', 'permissions.whyTerm', 'permissions.whyDetail',
    'steps.title', 'steps.methodTitle', 'steps.methodIntro',
    'states.title', 'states.intro', 'states.goodTerm', 'states.goodDetail', 'states.degradedTerm', 'states.degradedDetail',
    'failures.title', 'failures.intro',
    'manage.title', 'manage.intro', 'manage.disconnectTitle', 'manage.disconnectDetail',
  ];

  const at = (tree: unknown, path: string): unknown =>
    path.split('.').reduce<unknown>((node, step) => (typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[step] : undefined), tree);

  it('THE RULING: every key every guide renders exists, in both languages', () => {
    const missing: string[] = [];
    for (const id of GUIDED) {
      const { steps, failures } = GUIDE_CHAPTERS[id];
      // A guide with no chapters does not use this body, so it has nothing to be missing.
      if (steps.length === 0 && failures.length === 0) continue;

      const keys = [
        ...FIXED,
        ...steps.flatMap((step) => [`steps.${step}.title`, `steps.${step}.purpose`, `steps.${step}.body`]),
        ...failures.flatMap((failure) => [`failures.${failure}.title`, `failures.${failure}.fix`]),
        ...[0, 1, 2, 3].flatMap((index) => [`chain.${index}.title`, `chain.${index}.detail`]),
      ];
      for (const key of keys) {
        for (const [locale, messages] of [['en', en], ['fr', fr]] as const) {
          if (typeof at(messages, `GettingStarted.${id}.${key}`) !== 'string') missing.push(`${locale} GettingStarted.${id}.${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
