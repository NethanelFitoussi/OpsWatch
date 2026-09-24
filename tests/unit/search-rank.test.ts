import { describe, expect, it } from 'vitest';
import { queryWords, rank, scoreCandidate, type SearchCandidate } from '@/lib/search/rank';

/**
 * Getting the right row to the top.
 *
 * Search is judged by its first result, so every ruling here is about ordering. The rules are argued with
 * in a test rather than by eye, which is what stops "it feels about right" becoming the specification.
 */

const candidate = (over: Partial<SearchCandidate>): SearchCandidate => ({
  kind: 'problem',
  id: 'x',
  title: 'web',
  context: 'Problem · Production · eu-west-1',
  href: '/x',
  ...over,
});

describe('scoring one candidate', () => {
  it('THE RULING: every word must match something, so a second word narrows', () => {
    const c = candidate({ title: 'checkout-api', context: 'Service · Production' });
    expect(scoreCandidate(c, queryWords('checkout'))).toBeGreaterThan(0);
    expect(scoreCandidate(c, queryWords('checkout production'))).toBeGreaterThan(0);
    // "payments" is nowhere on this candidate, so the candidate is out — not merely ranked lower.
    expect(scoreCandidate(c, queryWords('checkout payments'))).toBe(0);
  });

  it('THE RULING: an exact title beats a prefix beats a substring', () => {
    const exact = scoreCandidate(candidate({ title: 'web' }), queryWords('web'));
    const prefix = scoreCandidate(candidate({ title: 'web-frontend' }), queryWords('web'));
    const inside = scoreCandidate(candidate({ title: 'dev-dog-walker-web' }), queryWords('web'));
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(inside);
  });

  it('counts a hidden term, so an account number finds the connection it belongs to', () => {
    const c = candidate({ kind: 'connection', title: 'Production', context: 'Connection', terms: ['123456789012'] });
    expect(scoreCandidate(c, queryWords('123456789012'))).toBeGreaterThan(0);
  });

  it('weighs a title above a context, so a service is not buried under everything in its environment', () => {
    const named = scoreCandidate(candidate({ title: 'production' }), queryWords('production'));
    const merely = scoreCandidate(candidate({ title: 'web', context: 'Problem · Production' }), queryWords('production'));
    expect(named).toBeGreaterThan(merely);
  });
});

describe('ranking a list', () => {
  const problem = candidate({ kind: 'problem', id: 'p', title: 'redis', context: 'Problem' });
  const doc = candidate({ kind: 'doc', id: 'd', title: 'redis', context: 'Documentation' });
  const jump = candidate({ kind: 'sectionSearch', id: 's', title: 'Search Redis nodes', context: 'Production', terms: ['redis'] });

  it('THE RULING: at three in the morning, the thing that is wrong comes before the reading about it', () => {
    expect(rank([doc, problem], 'redis', 10)[0].kind).toBe('problem');
  });

  it('THE RULING: an offer to look elsewhere is always last', () => {
    // It is not something OpsWatch found; it is an admission that it has not indexed live resources.
    const ordered = rank([jump, problem, doc], 'redis', 10);
    expect(ordered[ordered.length - 1].kind).toBe('sectionSearch');
  });

  it('THE RULING: and it loses even to an equally good match, because only the kind separates them', () => {
    // Identical title and context, so the scores tie and nothing but the kind can break it. Without that
    // rule the offer can float to the top of a list of real findings.
    const tied = (kind: SearchCandidate['kind'], id: string) => candidate({ kind, id, title: 'redis', context: 'Production' });
    const ordered = rank([tied('sectionSearch', 'jump'), tied('problem', 'p'), tied('doc', 'd')], 'redis', 10);
    expect(ordered.map((result) => result.kind)).toEqual(['problem', 'doc', 'sectionSearch']);
  });

  it('answers nothing for an empty query rather than everything', () => {
    expect(rank([problem, doc], '', 10)).toEqual([]);
    expect(rank([problem, doc], '   ', 10)).toEqual([]);
  });

  it('drops what does not match at all', () => {
    expect(rank([problem, doc], 'postgres', 10).filter((r) => r.kind !== 'sectionSearch')).toEqual([]);
  });

  it('is bounded, because search is how you reach one thing', () => {
    const many = Array.from({ length: 50 }, (_, i) => candidate({ id: `p${i}`, title: `web-${i}` }));
    expect(rank(many, 'web', 5)).toHaveLength(5);
  });

  it('is stable: the same input twice orders the same way', () => {
    const many = [problem, doc, jump, candidate({ id: 'p2', title: 'redis', context: 'Problem' })];
    expect(rank(many, 'redis', 10).map((r) => r.id)).toEqual(rank(many, 'redis', 10).map((r) => r.id));
  });
});
