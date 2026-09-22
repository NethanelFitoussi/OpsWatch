import { describe, expect, it } from 'vitest';
import { LIST_FILTERS, RESERVED_LIST_PARAMS, filtersFor } from '@opswatch/contract';
import { enumFilter, parseListFilters } from '@/lib/api/v1/request';
import { PROBLEM_NEW_MS, listProblems, statusWindowsFor } from '@/lib/read/problems';
import { storedErrorStatuses } from '@/lib/read/errors';
import { insertProblem, updateProblem } from '@/lib/store/problems';
import { createTestDb } from '../helpers/db';
import { newProblem } from '../helpers/detect';

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const env = { connectionId: 'c1', scope: 'us-east-1' };
const context = { nowMs: NOW, render: (key: string) => key };
const url = (query: string) => new URL(`https://opswatch.test/api/v1/problems?env=c1:us-east-1${query}`);

/**
 * The failure this whole mechanism exists to prevent: the mobile app sent `?status=&severity=&service=` to
 * `/problems`, the route read only `env`, `cursor` and `limit`, and every filter was dropped in silence. A
 * chip lit up, a full unfiltered page came back, and the list rendered unchanged — which reads as "there is
 * one critical problem" rather than "filtering did not happen".
 */

describe('an unrecognised filter is refused, never ignored', () => {
  it('THE RULING: a parameter this endpoint does not filter on fails the request', () => {
    expect(parseListFilters(url('&category=infra'), '/problems')).toEqual({ ok: false, error: 'invalid_request' });
  });

  it('leaves the parameters every list reads alone', () => {
    expect(parseListFilters(url('&cursor=abc&limit=10'), '/problems').ok).toBe(true);
    for (const name of RESERVED_LIST_PARAMS) expect(typeof name).toBe('string');
  });

  it('refuses a filter that belongs to another endpoint', () => {
    // `severity` is a problems filter; errors do not have one, so asking is a mistake worth reporting.
    expect(parseListFilters(new URL('https://o.test/x?env=c1:r&severity=critical'), '/errors').ok).toBe(false);
    expect(parseListFilters(url('&severity=critical'), '/problems').ok).toBe(true);
  });
});

describe('reading the values', () => {
  it('accepts a filter repeated, and a comma-separated list, as the same thing', () => {
    const repeated = parseListFilters(url('&status=new&status=active'), '/problems');
    const commas = parseListFilters(url('&status=new,active'), '/problems');
    expect(repeated).toMatchObject({ ok: true, status: ['new', 'active'] });
    expect(commas).toMatchObject({ ok: true, status: ['new', 'active'] });
  });

  it('reads an absent filter as null, which is different from an empty one', () => {
    expect(parseListFilters(url(''), '/problems')).toMatchObject({ ok: true, status: null, severity: null, service: null, sinceMs: null });
    // `?status=` asked for nothing in particular rather than for nothing at all.
    expect(parseListFilters(url('&status='), '/problems')).toMatchObject({ ok: true, status: null });
  });

  it('refuses a repeated `service`, because two services is not a union anyone asked for', () => {
    expect(parseListFilters(url('&service=a&service=b'), '/problems').ok).toBe(false);
    expect(parseListFilters(url('&service=a'), '/problems')).toMatchObject({ ok: true, service: 'a' });
  });

  it('refuses a `since` that is not epoch milliseconds', () => {
    expect(parseListFilters(url('&since=yesterday'), '/problems').ok).toBe(false);
    expect(parseListFilters(url('&since=-1'), '/problems').ok).toBe(false);
    expect(parseListFilters(url(`&since=${NOW}`), '/problems')).toMatchObject({ ok: true, sinceMs: NOW });
  });
});

describe('a value outside the closed list fails the whole request', () => {
  it('THE RULING: one unknown value is not quietly dropped, which would answer a narrower question', () => {
    expect(enumFilter(['new', 'nonsense'], ['new', 'active'] as const)).toEqual({ ok: false });
    expect(enumFilter(['new'], ['new', 'active'] as const)).toEqual({ ok: true, values: ['new'] });
    expect(enumFilter(null, ['new'] as const)).toEqual({ ok: true });
  });
});

describe('the contract declares only what the server honours', () => {
  it('names the filters for each list endpoint', () => {
    expect(filtersFor('/problems')).toEqual({ status: 'enum', severity: 'enum', service: 'string', since: 'epoch' });
    expect(filtersFor('/errors')).toEqual({ status: 'enum', service: 'string', since: 'epoch' });
    // An endpoint with no declaration filters on nothing, which is a different answer from "not a list".
    expect(filtersFor('/health')).toBeNull();
    expect(Object.keys(LIST_FILTERS)).toEqual(['/problems', '/errors']);
  });
});

describe('a wire status is translated, not passed through', () => {
  it('THE RULING: `new` and `active` are one stored state told apart by age', () => {
    const boundary = NOW - PROBLEM_NEW_MS;
    expect(statusWindowsFor(['new'], NOW)).toEqual([{ status: ['open'], firstSeenFromMs: boundary }]);
    expect(statusWindowsFor(['active'], NOW)).toEqual([{ status: ['open'], firstSeenToMs: boundary }]);
  });

  it('answers `resolved` with the closed rows too, which no client is shown separately', () => {
    expect(statusWindowsFor(['resolved'], NOW)).toEqual([{ status: ['resolved', 'closed'] }]);
  });

  it('maps an error status back to every stored state it covers', () => {
    // Muting is a decision about notification, not a change in what the group is doing.
    expect(storedErrorStatuses(['recurring'])).toEqual(['ongoing', 'muted']);
    expect(storedErrorStatuses(['regression'])).toEqual(['regressed']);
    expect(storedErrorStatuses(['new', 'resolved'])).toEqual(['new', 'resolved']);
  });
});

describe('the filter actually reaches the rows', () => {
  const seed = (db: ReturnType<typeof createTestDb>, over: Record<string, unknown>, key: string) =>
    insertProblem(db, newProblem({ key: key.padEnd(32, 'x'), lastEvaluatedAt: NOW, ...over }));

  it('separates a new problem from an established one, in SQL rather than after the page', () => {
    const db = createTestDb();
    seed(db, { firstSeenAt: NOW - 60_000, lastSeenAt: NOW, subjectId: 'fresh' }, 'a');
    seed(db, { firstSeenAt: NOW - PROBLEM_NEW_MS * 3, lastSeenAt: NOW, subjectId: 'old' }, 'b');

    const fresh = listProblems(db, { ...env, wireStatus: ['new'] }, context);
    const established = listProblems(db, { ...env, wireStatus: ['active'] }, context);
    expect(fresh.items).toHaveLength(1);
    expect(established.items).toHaveLength(1);
    expect(fresh.items[0]?.id).not.toBe(established.items[0]?.id);
  });

  it('filters by severity, and a request for one severity does not return the others', () => {
    const db = createTestDb();
    seed(db, { severity: 'critical', firstSeenAt: NOW - 1000, lastSeenAt: NOW }, 'c');
    seed(db, { severity: 'warning', firstSeenAt: NOW - 1000, lastSeenAt: NOW }, 'd');

    const critical = listProblems(db, { ...env, severity: ['critical'] }, context);
    expect(critical.items).toHaveLength(1);
    expect(critical.items[0]?.severity).toBe('critical');
  });

  it('filters by service', () => {
    const db = createTestDb();
    seed(db, { serviceId: 'prod/api', firstSeenAt: NOW - 1000, lastSeenAt: NOW }, 'e');
    seed(db, { serviceId: 'prod/web', firstSeenAt: NOW - 1000, lastSeenAt: NOW }, 'f');
    expect(listProblems(db, { ...env, serviceId: 'prod/api' }, context).items).toHaveLength(1);
  });

  it('combines statuses with an OR, so asking for two returns both', () => {
    const db = createTestDb();
    seed(db, { firstSeenAt: NOW - 60_000, lastSeenAt: NOW }, 'g');
    const resolved = seed(db, { firstSeenAt: NOW - 60_000, lastSeenAt: NOW }, 'h');
    updateProblem(db, resolved.id, { status: 'resolved', resolvedAt: NOW });

    expect(listProblems(db, { ...env, wireStatus: ['new'] }, context).items).toHaveLength(1);
    expect(listProblems(db, { ...env, wireStatus: ['new', 'resolved'] }, context).items).toHaveLength(2);
  });
});
