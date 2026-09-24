import { describe, expect, it } from 'vitest';
import { DOCS, DOC_CATEGORIES, docPath, findGuide, guidesInCategory, searchGuides } from '@/lib/docs/catalogue';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';

/**
 * The documentation is a product surface, so it gets the checks a product surface gets.
 *
 * The failure this guards against is the quiet one: a guide that exists in the catalogue, is linked from
 * a page, and renders its own message keys at a reader because nobody wrote the French — or worse, a
 * "Next step" link that points at a guide that was renamed.
 */

type Tree = { [key: string]: string | Tree };
const guides = (catalogue: Tree) => ((catalogue as { Docs: { guides: Record<string, Tree> } }).Docs.guides);

describe('every guide is complete in both languages', () => {
  it('THE RULING: has a title, a summary, what it does and how to verify — in English and in French', () => {
    for (const locale of [en, fr] as unknown as Tree[]) {
      for (const guide of DOCS) {
        const body = guides(locale)[guide.slug];
        expect(body, `${guide.slug}`).toBeTypeOf('object');
        for (const key of ['title', 'summary', 'what', 'verify']) {
          expect(typeof body[key], `${guide.slug}.${key}`).toBe('string');
          expect((body[key] as string).length, `${guide.slug}.${key}`).toBeGreaterThan(10);
        }
      }
    }
  });

  it('THE RULING: says how to verify it worked, because a guide that ends at the last step is half a guide', () => {
    for (const guide of DOCS) {
      expect((guides(en as unknown as Tree)[guide.slug].verify as string).length, guide.slug).toBeGreaterThan(20);
    }
  });

  it('keeps the same number of steps and the same questions in both languages', () => {
    for (const guide of DOCS) {
      const a = guides(en as unknown as Tree)[guide.slug];
      const b = guides(fr as unknown as Tree)[guide.slug];
      for (const key of ['steps', 'problems', 'before', 'next', 'flow']) {
        const left = a[key] === undefined ? 0 : Object.keys(a[key] as Tree).length;
        const right = b[key] === undefined ? 0 : Object.keys(b[key] as Tree).length;
        expect(right, `${guide.slug}.${key}`).toBe(left);
      }
    }
  });

  it('THE RULING: every "next step" points at a guide that exists', () => {
    for (const guide of DOCS) {
      const next = guides(en as unknown as Tree)[guide.slug].next as Tree | undefined;
      for (const entry of Object.values(next ?? {})) {
        const href = (entry as Tree).href as string;
        // A guide slug, or an in-app path. A slug that matches nothing is a dead end with a label on it.
        if (!href.startsWith('/')) expect(findGuide(href), `${guide.slug} → ${href}`).not.toBeNull();
      }
    }
  });

  it('carries no prose for a guide the catalogue does not have', () => {
    const slugs = new Set(DOCS.map((guide) => guide.slug));
    expect(Object.keys(guides(en as unknown as Tree)).filter((slug) => !slugs.has(slug))).toEqual([]);
  });

  it('gives every category at least one guide, so no category renders as an empty heading', () => {
    for (const category of DOC_CATEGORIES) {
      expect(guidesInCategory(category).length, category).toBeGreaterThan(0);
    }
  });
});

describe('finding a guide', () => {
  const text = (slug: string) => {
    const body = guides(en as unknown as Tree)[slug];
    return { title: body.title as string, summary: body.summary as string };
  };

  it('THE RULING: finds the guide from words the guide itself does not use', () => {
    // Somebody looking for "save metrics" does not know the feature is called historical collection, and a
    // search that only matches a guide's own vocabulary only helps people who already know the answer.
    expect(searchGuides('save metrics', text)[0].slug).toBe('history');
    expect(searchGuides('why warning', text)[0].slug).toBe('reading-status');
    expect(searchGuides('kubernetes monitoring', text)[0].slug).toBe('kubernetes');
    expect(searchGuides('redis cpu', text)[0].slug).toBe('redis');
    expect(searchGuides('connect github', text)[0].slug).toBe('connect-github');
    expect(searchGuides('aws permissions', text)[0].slug).toBe('aws-permissions');
  });

  it('matches every word rather than the whole phrase, so two-word searches work', () => {
    expect(searchGuides('redis memory', text).map((guide) => guide.slug)).toContain('redis');
  });

  it('returns nothing rather than everything when nothing matches', () => {
    expect(searchGuides('xyzzy', text)).toEqual([]);
  });

  it('returns the whole catalogue for an empty query', () => {
    expect(searchGuides('  ', text)).toHaveLength(DOCS.length);
  });

  it('builds a path a router can resolve', () => {
    expect(docPath('redis')).toBe('/docs/redis');
    expect(findGuide('nope')).toBeNull();
  });
});
