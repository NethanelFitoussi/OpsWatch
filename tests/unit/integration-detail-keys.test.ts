import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Every detail sentence an integration card can ask for, in every namespace that renders one.
 *
 * `integrationStatuses` returns a `detailKey`, and four pages render it as `` t(`detail.${key}`) ``
 * against four **different** namespaces. A key composed at run time is invisible to
 * `message-namespaces.test.ts`, which reads literal `t('…')` calls — and next-intl does not throw for
 * a missing message, it renders the key path. So `Settings.integrations.detail.gcpFailing` appeared,
 * in those words, on the connections page of an installation whose Google project could not be read.
 *
 * It had been there since Google connections were added. It only shows when something is *failing*,
 * which is exactly when an operator is reading the page.
 */

const KEY_SOURCE = new URL('../../src/lib/integrations/status.ts', import.meta.url);

/**
 * Where each page looks the sentence up, and which integrations that page can show one for.
 *
 * `google` is sign-in rather than something OpsWatch reads from, so it is `connectable: false` and
 * the two pages that only offer connectable integrations never ask for its sentences. Encoded here
 * rather than assumed, because "the three blocks should be identical" is the tempting shortcut and
 * it is wrong: they are three audiences, not three copies.
 */
const RENDERERS: readonly { namespace: string; connectableOnly: boolean }[] = [
  { namespace: 'Settings.integrations.detail', connectableOnly: false },
  { namespace: 'Connect.detail', connectableOnly: true },
  { namespace: 'GettingStarted.hub.detail', connectableOnly: true },
];

/** Which integration a key belongs to, by the id it is named after. Longest match wins: `ai` vs `aws`. */
const OWNERS = ['cloudflare', 'github', 'google', 'gcp', 'aws', 'ai', 'do'] as const;
const ownerOf = (key: string): string | null =>
  [...OWNERS].sort((a, b) => b.length - a.length).find((owner) => key.toLowerCase().startsWith(owner)) ?? null;

/** Every `detailKey` the status module can return, read from it rather than kept by hand here. */
function detailKeys(): string[] {
  const source = readFileSync(KEY_SOURCE, 'utf8');
  const keys = new Set<string>();
  for (const line of source.split('\n')) {
    if (!line.includes('detailKey:')) continue;
    // Only the quoted literals on a `detailKey:` line, and not the `status === 'configured'` it is
    // often compared against — that is a status, and taking it for a key is how a guard invents work.
    const assignment = line.slice(line.indexOf('detailKey:'));
    for (const match of assignment.matchAll(/'([a-zA-Z][a-zA-Z_]*)'/g)) {
      if (!assignment.includes(`=== '${match[1]}'`)) keys.add(match[1]);
    }
    // `ai_${status}` and `cloudflare_${status}`, over the statuses those comparisons leave behind.
    const template = /`([a-z]+)_\$\{/.exec(assignment);
    if (template !== null) for (const status of ['untested', 'failed']) keys.add(`${template[1]}_${status}`);
  }
  return [...keys];
}

const at = (messages: Record<string, unknown>, path: string): Record<string, string> | undefined =>
  path.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages) as
    | Record<string, string>
    | undefined;

describe('the sentence under an integration card', () => {
  it('finds the keys from the code rather than from a list kept beside it', async () => {
    // Empty, and the ruling below passes vacuously — the failure mode a derived list has, so it is
    // asserted rather than assumed. Each key must also belong to an integration somebody can name.
    const keys = detailKeys();
    expect(keys.length).toBeGreaterThanOrEqual(10);
    expect(keys).toContain('gcpFailing');
    expect(keys).toContain('doFailing');
    expect(keys).toContain('ai_failed');
    // A status is not a key: `connection.status === 'configured'` sits on the same line as one.
    expect(keys).not.toContain('configured');
    for (const key of keys) expect(ownerOf(key), key).not.toBeNull();
  });

  it('THE RULING: every key exists in every namespace that renders it, in both languages', async () => {
    /*
     * `integrationStatuses` returns a `detailKey`, and several pages render it as
     * `` t(`detail.${key}`) `` against **different** namespaces. A key composed at run time is
     * invisible to `message-namespaces.test.ts`, which reads literal `t('…')` calls, and next-intl
     * does not throw for a missing message — it renders the key path. So
     * `Settings.integrations.detail.gcpFailing` appeared, in those words, on the connections page of
     * an installation whose Google project could not be read. It had been there since Google
     * connections were added, and it shows only when something is failing, which is precisely when
     * somebody is reading the page.
     */
    const { INTEGRATION_SPECS } = await import('@/lib/integrations/catalogue');
    const keys = detailKeys();
    const missing: string[] = [];

    for (const locale of ['en', 'fr']) {
      const messages = JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), 'utf8')) as Record<string, unknown>;
      for (const { namespace, connectableOnly } of RENDERERS) {
        const block = at(messages, namespace);
        expect(block, `${locale}: ${namespace}`).toBeDefined();
        for (const key of keys) {
          const owner = ownerOf(key) as keyof typeof INTEGRATION_SPECS;
          if (connectableOnly && INTEGRATION_SPECS[owner]?.connectable !== true) continue;
          if (typeof block?.[key] !== 'string') missing.push(`${locale}.${namespace}.${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
