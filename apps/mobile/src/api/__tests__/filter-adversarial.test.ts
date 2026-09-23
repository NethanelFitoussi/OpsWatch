/**
 * Filters, against input the app did not choose.
 *
 * `service` reaches the Problems and Errors lists from a route parameter, which means from a deep link, which means
 * from outside the app. It goes straight into a query string. `since` is computed from a chip, but a stale or
 * hostile route could carry anything. Neither is dangerous on its own — the server validates too — but the app
 * should not be the thing that forwards nonsense.
 */
import { isSafeId } from '@/lib/deep-links';
import { errorFiltersFor } from '@/features/errors/helpers';
import { DEFAULT_FILTERS, sinceFor, toProblemFilters } from '@/features/problems/helpers';

describe('a service id arriving from a link', () => {
  it.each([
    ['a path traversal', '../../etc/passwd'],
    ['an absolute path', '/etc/passwd'],
    ['a query string', 'svc&admin=1'],
    ['a fragment', 'svc#x'],
    ['whitespace', 'svc a'],
    ['a dot segment', '..'],
    ['an empty string', ''],
  ])('is refused before it can become a filter: %s', (_label, id) => {
    expect(isSafeId(id)).toBe(false);
  });

  it('accepts the shape a real service id has', () => {
    expect(isSafeId('svc-checkout-api')).toBe(true);
    expect(isSafeId('svc.checkout.api')).toBe(true);
  });
});

describe('what actually goes out', () => {
  it('sends no filter key at all when nothing is narrowing the list', () => {
    expect(toProblemFilters(DEFAULT_FILTERS)).toEqual({ status: 'open' });
    expect(errorFiltersFor('all', null, null)).toEqual({});
  });

  /** An undeclared parameter is now a 400, so an empty or absent value must be left out, not sent empty. */
  it('leaves an absent service out rather than sending an empty one', () => {
    expect(toProblemFilters({ ...DEFAULT_FILTERS, service: null })).not.toHaveProperty('service');
    expect(errorFiltersFor('all', '', null)).not.toHaveProperty('service');
    expect(errorFiltersFor('all', null, null)).not.toHaveProperty('since');
  });

  /** `since` is an instant, and an instant the app computed — never a string from somewhere else. */
  it('only ever sends a number for since', () => {
    const filters = toProblemFilters({ ...DEFAULT_FILTERS, since: sinceFor('24h', 1_800_000_000_000) });
    expect(typeof filters.since).toBe('number');
    expect(Number.isFinite(filters.since)).toBe(true);
  });

  it('sorts severities so the same selection is always the same query key', () => {
    const one = toProblemFilters({ ...DEFAULT_FILTERS, severities: ['warning', 'critical'] });
    const two = toProblemFilters({ ...DEFAULT_FILTERS, severities: ['critical', 'warning'] });
    expect(one).toEqual(two);
  });
});
