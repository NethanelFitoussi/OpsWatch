import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PROVIDERS } from '@/lib/connections/types';

/**
 * The one page whose job is to say what this installation is connected to.
 *
 * It drew every connection with the AWS glyph and the word "AWS" — a Google project and a
 * DigitalOcean account both presented as AWS accounts, on the screen that exists to tell them apart.
 * The mission's words for this are "do not erase provider identity", and a static check is the right
 * shape for it: the failure is a hardcoded literal, and a hardcoded literal is exactly what a source
 * assertion catches and a rendering test does not.
 */

const source = readFileSync(new URL('../../src/app/[locale]/(app)/accounts/page.tsx', import.meta.url), 'utf8');
/** The block that draws one connection, which is where the provider must come from the connection. */
const connectionCard = source.slice(source.indexOf('scope="connection"') - 400, source.indexOf('scope="connection"') + 400);

const card = readFileSync(new URL('../../src/components/connections/connection-card.tsx', import.meta.url), 'utf8');

describe('the connections overview', () => {
  it('THE RULING: a connection card says its cloud in writing, not only as a glyph', () => {
    /*
     * The provider name was `sr-only`, which is right for an integration card — its title *is* the
     * provider's name — and leaves a connection card showing nothing but a glyph, since its title is
     * whatever the operator called it. AWS's glyph is a plain cloud and Google's is a cloud with a
     * cog. Identity that rests on telling those apart at 16px is identity erased.
     */
    expect(card).toContain("{scope === 'connection' && <span className=\"truncate text-xs font-normal text-muted-foreground\">{provider}</span>}");
    // And the hidden copy is now only on the cards that have no visible one, so no card says it twice.
    expect(card).toContain("{scope === 'integration' && <span className=\"sr-only\">{provider}</span>}");
  });

  it('THE RULING: a card carries its own cloud, not AWS for everything', () => {
    expect(connectionCard).toContain('integration={c.provider}');
    expect(connectionCard).toContain('provider={t(`provider.${c.provider}`)}');
    // The literals that were there, and that no amount of passing tests would have flagged.
    expect(connectionCard).not.toContain('integration="aws"');
    expect(connectionCard).not.toContain("t('provider.aws')");
  });

  it('THE RULING: every provider has a name to show, so none renders as a key path', () => {
    /*
     * next-intl does not throw for a missing message — it renders `Accounts.provider.do`. Now that the
     * label is built from the connection's provider, a provider without a message is a key path on
     * screen rather than an error anywhere.
     */
    for (const locale of ['en', 'fr']) {
      const messages = JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), 'utf8')) as {
        Accounts: { provider: Record<string, string> };
      };
      for (const provider of PROVIDERS) {
        const label = messages.Accounts.provider[provider];
        expect(label, `${locale}.${provider}`).toBeTypeOf('string');
        expect(label, `${locale}.${provider}`).not.toBe('');
      }
    }
  });

  it('counts every connection, not the filtered ones', () => {
    // A count that changed when you filtered would answer a different question from the one it looks
    // like it answers. The counts are built before the filter and the filter reads them.
    const counting = source.slice(source.indexOf('const counts ='), source.indexOf('const shown ='));
    expect(counting).toContain('for (const view of views)');
    expect(counting).not.toContain('shown');
  });

  it('filters through the URL, so a filtered view can be sent to somebody', () => {
    expect(source).toContain("query: { provider }");
    // And an unknown provider in the query falls back to everything rather than to an empty page.
    expect(source).toContain('present.find((provider) => provider === asked) ?? null');
  });
});
