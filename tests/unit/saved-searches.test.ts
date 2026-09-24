import { describe, expect, it } from 'vitest';
import { adminUser } from '@/lib/db/schema';
import { LOGS_MAX_GROUPS, LOGS_MAX_QUERY_LENGTH } from '@/lib/monitoring/logs';
import {
  SAVED_SEARCHES_MAX,
  SAVED_SEARCH_NAME_MAX,
  duplicateName,
  normaliseSavedSearch,
  savedSearchParams,
  type SavedSearchFields,
} from '@/lib/monitoring/shared/saved-search';
import {
  createSavedSearch,
  deleteSavedSearch,
  fieldsOf,
  getSavedSearch,
  listSavedSearches,
  updateSavedSearch,
} from '@/lib/store/saved-searches';
import { createTestDb } from '../helpers/db';

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);
const LIMITS = { maxGroups: LOGS_MAX_GROUPS, maxQueryLength: LOGS_MAX_QUERY_LENGTH };
const SCOPE = { connectionId: 'c1', scope: 'us-east-1' };

const raw = (over: Partial<Parameters<typeof normaliseSavedSearch>[0]> = {}) => ({
  name: 'Payments errors',
  text: 'timeout',
  level: 'error' as string | null,
  limit: 100,
  range: '1h',
  logGroups: ['/ecs/web'],
  query: null as string | null,
  ...over,
});

const fields = (over: Partial<SavedSearchFields> = {}): SavedSearchFields => {
  const checked = normaliseSavedSearch(raw(), LIMITS);
  if (!checked.ok) throw new Error('fixture is invalid');
  return { ...checked.value, ...over };
};

const withUsers = () => {
  const db = createTestDb();
  const make = (email: string) =>
    db.insert(adminUser).values({ email, passwordHash: 'x', createdAt: new Date(NOW) }).returning().get().id;
  return { db, alice: make('alice@example.com'), bob: make('bob@example.com') };
};

describe('what may be saved', () => {
  it('trims and keeps what a search is made of', () => {
    const checked = normaliseSavedSearch(raw({ name: '  Payments errors  ', text: ' timeout ' }), LIMITS);
    expect(checked).toEqual({
      ok: true,
      value: { name: 'Payments errors', text: 'timeout', level: 'error', limit: 100, range: '1h', logGroups: ['/ecs/web'], query: null },
    });
  });

  it('refuses a search with no name and one with an essay for a name', () => {
    expect(normaliseSavedSearch(raw({ name: '   ' }), LIMITS)).toEqual({ ok: false, error: 'name_required' });
    expect(normaliseSavedSearch(raw({ name: 'x'.repeat(SAVED_SEARCH_NAME_MAX + 1) }), LIMITS)).toEqual({ ok: false, error: 'name_too_long' });
  });

  it('THE RULING: an unknown range is refused, never clamped into one that would search a different window', () => {
    expect(normaliseSavedSearch(raw({ range: '7d' }), LIMITS)).toEqual({ ok: false, error: 'invalid_range' });
    expect(normaliseSavedSearch(raw({ level: 'catastrophe' }), LIMITS)).toEqual({ ok: false, error: 'invalid_level' });
    expect(normaliseSavedSearch(raw({ limit: 999_999 }), LIMITS)).toEqual({ ok: false, error: 'invalid_limit' });
  });

  it('bounds the log groups exactly as the query API bounds them', () => {
    expect(normaliseSavedSearch(raw({ logGroups: [] }), LIMITS)).toEqual({ ok: false, error: 'no_groups' });
    expect(normaliseSavedSearch(raw({ logGroups: ['  ', ''] }), LIMITS)).toEqual({ ok: false, error: 'no_groups' });
    const many = Array.from({ length: LOGS_MAX_GROUPS + 1 }, (_, i) => `/g/${i}`);
    expect(normaliseSavedSearch(raw({ logGroups: many }), LIMITS)).toEqual({ ok: false, error: 'too_many_groups' });
    // Duplicates are one group, not two of the cap.
    const checked = normaliseSavedSearch(raw({ logGroups: ['/ecs/web', '/ecs/web'] }), LIMITS);
    expect(checked.ok && checked.value.logGroups).toEqual(['/ecs/web']);
  });

  it('bounds a stored query at the same length the query API accepts', () => {
    expect(normaliseSavedSearch(raw({ query: 'x'.repeat(LOGS_MAX_QUERY_LENGTH + 1) }), LIMITS)).toEqual({ ok: false, error: 'query_too_long' });
    // A blank query is "the search box built it", not an empty query.
    const checked = normaliseSavedSearch(raw({ query: '   ' }), LIMITS);
    expect(checked.ok && checked.value.query).toBeNull();
  });

  it('THE RULING: only a relative range is ever stored', () => {
    // There is nowhere to put an absolute window: a saved search must still mean something next week.
    const checked = normaliseSavedSearch(raw(), LIMITS);
    expect(checked.ok && Object.keys(checked.value).sort()).toEqual(['level', 'limit', 'logGroups', 'name', 'query', 'range', 'text']);
    expect(savedSearchParams(fields())).not.toMatch(/start|end|from|to=/);
  });

  it('restores itself as an ordinary query string', () => {
    const params = new URLSearchParams(savedSearchParams(fields({ logGroups: ['/a', '/b'] })));
    expect(params.get('q')).toBe('timeout');
    expect(params.get('level')).toBe('error');
    expect(params.get('range')).toBe('1h');
    expect(params.getAll('group')).toEqual(['/a', '/b']);
  });
});

describe('naming a copy', () => {
  it('takes the first free number', () => {
    expect(duplicateName('Errors', [])).toBe('Errors (2)');
    expect(duplicateName('Errors', ['Errors (2)', 'Errors (3)'])).toBe('Errors (4)');
  });

  it('keeps the copy inside the name limit', () => {
    expect(duplicateName('x'.repeat(SAVED_SEARCH_NAME_MAX), []).length).toBeLessThanOrEqual(SAVED_SEARCH_NAME_MAX);
  });
});

describe('THE RULING: a saved search belongs to one person', () => {
  it('is not listed for anybody else', () => {
    const { db, alice, bob } = withUsers();
    createSavedSearch(db, alice, SCOPE, fields(), NOW);
    expect(listSavedSearches(db, alice, SCOPE)).toHaveLength(1);
    expect(listSavedSearches(db, bob, SCOPE)).toEqual([]);
  });

  it('is not readable by id by anybody else', () => {
    const { db, alice, bob } = withUsers();
    const created = createSavedSearch(db, alice, SCOPE, fields(), NOW);
    const id = created.ok ? created.row.id : '';
    expect(getSavedSearch(db, alice, id)).toBeDefined();
    // Knowing the id is not the same as owning it, and this is what stops a crafted form post.
    expect(getSavedSearch(db, bob, id)).toBeUndefined();
  });

  it('is not deletable or editable by anybody else', () => {
    const { db, alice, bob } = withUsers();
    const created = createSavedSearch(db, alice, SCOPE, fields(), NOW);
    const id = created.ok ? created.row.id : '';
    expect(deleteSavedSearch(db, bob, id)).toBe(false);
    expect(updateSavedSearch(db, bob, id, fields({ name: 'Stolen' }), NOW)).toEqual({ ok: false, error: 'not_found' });
    expect(listSavedSearches(db, alice, SCOPE)).toHaveLength(1);
    expect(listSavedSearches(db, alice, SCOPE)[0].name).toBe('Payments errors');
  });

  it('leaves another environment alone', () => {
    const { db, alice } = withUsers();
    createSavedSearch(db, alice, SCOPE, fields(), NOW);
    expect(listSavedSearches(db, alice, { connectionId: 'c1', scope: 'eu-west-1' })).toEqual([]);
    expect(listSavedSearches(db, alice, { connectionId: 'c2', scope: 'us-east-1' })).toEqual([]);
  });
});

describe('keeping a list of them', () => {
  it('round-trips every field', () => {
    const { db, alice } = withUsers();
    const created = createSavedSearch(db, alice, SCOPE, fields({ query: 'fields @message | limit 5' }), NOW);
    expect(created.ok).toBe(true);
    const row = listSavedSearches(db, alice, SCOPE)[0];
    expect(fieldsOf(row)).toEqual(fields({ query: 'fields @message | limit 5' }));
  });

  it('refuses a second search with the same name, and allows the same name elsewhere', () => {
    const { db, alice } = withUsers();
    createSavedSearch(db, alice, SCOPE, fields(), NOW);
    expect(createSavedSearch(db, alice, SCOPE, fields(), NOW)).toEqual({ ok: false, error: 'name_taken' });
    expect(createSavedSearch(db, alice, { connectionId: 'c1', scope: 'eu-west-1' }, fields(), NOW).ok).toBe(true);
  });

  it('refuses to rename one onto another', () => {
    const { db, alice } = withUsers();
    createSavedSearch(db, alice, SCOPE, fields(), NOW);
    const second = createSavedSearch(db, alice, SCOPE, fields({ name: 'Slow requests' }), NOW);
    const id = second.ok ? second.row.id : '';
    expect(updateSavedSearch(db, alice, id, fields({ name: 'Payments errors' }), NOW)).toEqual({ ok: false, error: 'name_taken' });
    // Renaming to its own name is not a clash with itself.
    expect(updateSavedSearch(db, alice, id, fields({ name: 'Slow requests', text: 'slow' }), NOW).ok).toBe(true);
  });

  it('stops at the cap rather than letting one person fill the table', () => {
    const { db, alice } = withUsers();
    for (let i = 0; i < SAVED_SEARCHES_MAX; i += 1) createSavedSearch(db, alice, SCOPE, fields({ name: `Search ${i}` }), NOW);
    expect(createSavedSearch(db, alice, SCOPE, fields({ name: 'One more' }), NOW)).toEqual({ ok: false, error: 'too_many_saved' });
  });

  it('updates in place, keeping its id and when it was created', () => {
    const { db, alice } = withUsers();
    const created = createSavedSearch(db, alice, SCOPE, fields(), NOW);
    const id = created.ok ? created.row.id : '';
    const updated = updateSavedSearch(db, alice, id, fields({ text: 'gateway', range: '24h' }), NOW + 1000);
    expect(updated.ok && updated.row).toMatchObject({ id, createdAt: NOW, updatedAt: NOW + 1000, searchText: 'gateway', range: '24h' });
  });

  it('deletes only what was asked for', () => {
    const { db, alice } = withUsers();
    const created = createSavedSearch(db, alice, SCOPE, fields(), NOW);
    createSavedSearch(db, alice, SCOPE, fields({ name: 'Other' }), NOW);
    expect(deleteSavedSearch(db, alice, created.ok ? created.row.id : '')).toBe(true);
    expect(listSavedSearches(db, alice, SCOPE).map((row) => row.name)).toEqual(['Other']);
    expect(deleteSavedSearch(db, alice, 'does-not-exist')).toBe(false);
  });
});
