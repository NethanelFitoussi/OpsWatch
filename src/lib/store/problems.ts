import 'server-only';
import { and, asc, desc, eq, gt, gte, inArray, isNull, isNotNull, lt, or, sql } from 'drizzle-orm';
import type { DetectedProblem } from '../detect/types';
import type { LiveProblem, Transition } from '../detect/lifecycle';
import { severityForScore, scoreProblem } from '../detect/score';
import { randomId } from '../crypto';
import { appendEvent } from './events';
import type { Db } from '../db/client';
import {
  PROBLEM_SEVERITIES,
  problemEvidence,
  problems,
  type EvidenceKind,
  type ProblemEvidenceRow,
  type ProblemRow,
  type ProblemSeverity,
  type ProblemStatus,
  type StoredScoreTerms,
  type SubjectType,
} from '../db/schema';

/**
 * Everything the product knows about a `problems` row, and the only place those statements live (§9.6).
 *
 * Two rules shape this file. A problem is identified by its dedupe key, and only one row per key may be live at a
 * time — the partial unique index enforces that, so a second detector writing the same trouble fails loudly rather
 * than quietly doubling it. And a list pages on `seq`, the autoincrement assigned at insert, never on `score`,
 * `severity` or `lastSeenAt`: those all move while a client is paging, and a moving cursor axis makes a page skip
 * rows or repeat them (§33.6). Severity and recency are sort options applied inside a page.
 */
export type NewEvidence = {
  kind: EvidenceKind;
  labelKey: string;
  values: Record<string, string | number>;
  /** `null` is "not measured" (§2.4). It is never written as 0. */
  value: number | null;
  unit: string | null;
  at: number;
  seriesRef?: string;
  href?: string;
};

export type NewProblem = {
  key: string;
  connectionId: string;
  scope: string;
  kind: string;
  subjectType: SubjectType;
  subjectId: string;
  subjectName: string;
  serviceId: string | null;
  source: string;
  titleKey: string;
  values: Record<string, string | number>;
  severity: ProblemSeverity;
  score: number;
  scoreTerms: StoredScoreTerms;
  href: string;
  firstSeenAt: number;
  lastSeenAt: number;
  lastEvaluatedAt: number;
  /** The row this one succeeds when trouble came back after being resolved, so a flap keeps its history. */
  previousProblemId: string | null;
  evidence: readonly NewEvidence[];
};

/** Rows the caller may change. `seq`, `id` and `key` are the identity of the row and never move. */
export type ProblemPatch = Partial<Omit<ProblemRow, 'seq' | 'id' | 'key'>>;

export type ProblemFilter = {
  connectionId: string;
  scope: string;
  status?: readonly ProblemStatus[];
  severity?: readonly ProblemSeverity[];
  kind?: readonly string[];
  /**
   * Wire-status filtering, which is not a plain `status IN (…)`.
   *
   * The contract's `new` and `active` are the same stored state — `open` — told apart by age, so a request
   * for one of them is a status *and* a window on `firstSeenAt`. Each entry is one such pair and they are
   * OR-ed, which is the only way `?status=new&status=resolved` can mean what it says.
   */
  statusWindows?: readonly { status: readonly ProblemStatus[]; firstSeenFromMs?: number; firstSeenToMs?: number }[];
  serviceId?: string;
  sinceMs?: number;
  /** A child collapsed behind a fleet problem is hidden unless a caller asks for it (§33.8). */
  includeGrouped?: boolean;
};

export type SeqPage<T> = { items: T[]; nextSeq: number | null; nextId: string | null };

const evidenceRows = (problemId: string, evidence: readonly NewEvidence[]) =>
  evidence.map((item, position) => ({
    id: randomId(),
    problemId,
    position,
    kind: item.kind,
    labelKey: item.labelKey,
    values: item.values,
    value: item.value,
    unit: item.unit,
    at: item.at,
    seriesRef: item.seriesRef ?? null,
    href: item.href ?? null,
  }));

/**
 * Opens a problem with the evidence that argued for it, in one transaction: a problem without its bundle would be
 * a verdict with no arithmetic behind it, which §4.3 does not allow to exist even briefly.
 *
 * Throws when the key already has a live row. That is the unique index doing its job, not an error to swallow.
 */
export function insertProblem(db: Db, input: NewProblem): ProblemRow {
  const { evidence, ...row } = input;
  const id = randomId();
  return db.transaction((tx) => {
    const inserted = tx
      .insert(problems)
      .values({ ...row, id, status: 'open' })
      .returning()
      .get();
    if (evidence.length > 0) {
      tx.insert(problemEvidence).values(evidenceRows(id, evidence)).run();
    }
    return inserted;
  });
}

/** The live row for a dedupe key, or null. "Live" is exactly "not resolved": the partial index indexes only these. */
export function findLiveProblem(db: Db, key: string): ProblemRow | null {
  return db
    .select()
    .from(problems)
    .where(and(eq(problems.key, key), isNull(problems.resolvedAt)))
    .get() ?? null;
}

/**
 * The most recently resolved row for a key, if it was resolved no earlier than `notBeforeMs`. This is what makes a
 * reopen a continuation rather than a new problem: trouble that returns inside the window keeps its history.
 */
export function findRecentResolved(db: Db, key: string, notBeforeMs: number): ProblemRow | null {
  return db
    .select()
    .from(problems)
    .where(and(eq(problems.key, key), isNotNull(problems.resolvedAt), gte(problems.resolvedAt, notBeforeMs)))
    .orderBy(desc(problems.resolvedAt), desc(problems.seq))
    .limit(1)
    .get() ?? null;
}

/** The newest row for a key whatever its status, which is how a detector tells "seen before" from "never seen". */
export function findLastProblemForKey(db: Db, key: string): ProblemRow | null {
  return db.select().from(problems).where(eq(problems.key, key)).orderBy(desc(problems.seq)).limit(1).get() ?? null;
}

export function findProblemById(db: Db, id: string): ProblemRow | null {
  return db.select().from(problems).where(eq(problems.id, id)).get() ?? null;
}

export function updateProblem(db: Db, id: string, patch: ProblemPatch): ProblemRow {
  return db.update(problems).set(patch).where(eq(problems.id, id)).returning().get();
}

/**
 * Replaces a problem's evidence wholesale. The bundle is the current argument for the problem, not a log of every
 * argument ever made, so a re-evaluation restates it rather than appending to it — and `position` keeps the order
 * the detector put it in.
 */
export function replaceEvidence(db: Db, problemId: string, evidence: readonly NewEvidence[]): void {
  db.transaction((tx) => {
    tx.delete(problemEvidence).where(eq(problemEvidence.problemId, problemId)).run();
    if (evidence.length > 0) {
      tx.insert(problemEvidence).values(evidenceRows(problemId, evidence)).run();
    }
  });
}

export function listEvidence(db: Db, problemId: string): ProblemEvidenceRow[] {
  return db
    .select()
    .from(problemEvidence)
    .where(eq(problemEvidence.problemId, problemId))
    .orderBy(asc(problemEvidence.position))
    .all();
}

function conditions(filter: ProblemFilter) {
  const where = [eq(problems.connectionId, filter.connectionId), eq(problems.scope, filter.scope)];
  if (filter.status?.length) where.push(inArray(problems.status, [...filter.status]));
  if (filter.severity?.length) where.push(inArray(problems.severity, [...filter.severity]));
  if (filter.kind?.length) where.push(inArray(problems.kind, [...filter.kind]));
  if (filter.statusWindows?.length) {
    const clauses = filter.statusWindows.map((window) =>
      and(
        inArray(problems.status, [...window.status]),
        ...(window.firstSeenFromMs === undefined ? [] : [gte(problems.firstSeenAt, window.firstSeenFromMs)]),
        ...(window.firstSeenToMs === undefined ? [] : [lt(problems.firstSeenAt, window.firstSeenToMs)]),
      ),
    );
    // A single clause still goes through `or`, so one window and several behave identically.
    const combined = or(...clauses);
    if (combined !== undefined) where.push(combined);
  }
  if (filter.serviceId !== undefined) where.push(eq(problems.serviceId, filter.serviceId));
  if (filter.sinceMs !== undefined) where.push(gte(problems.lastSeenAt, filter.sinceMs));
  if (!filter.includeGrouped) where.push(eq(problems.grouped, false));
  return where;
}

/**
 * One page of problems, oldest first, resumed from an immutable `(seq, id)` pair.
 *
 * It asks for one row more than it returns: the extra row is how the page knows whether there is another, without
 * a second count query and without the race a count would have.
 */
export function pageProblems(
  db: Db,
  filter: ProblemFilter,
  cursor: { afterSeq: number; afterId: string } | null,
  limit: number,
): SeqPage<ProblemRow> {
  const where = conditions(filter);
  if (cursor !== null) {
    where.push(
      or(gt(problems.seq, cursor.afterSeq), and(eq(problems.seq, cursor.afterSeq), gt(problems.id, cursor.afterId)))!,
    );
  }
  const rows = db
    .select()
    .from(problems)
    .where(and(...where))
    .orderBy(asc(problems.seq), asc(problems.id))
    .limit(limit + 1)
    .all();
  const items = rows.slice(0, limit);
  const more = rows.length > limit;
  const last = items[items.length - 1];
  return {
    items,
    nextSeq: more && last ? last.seq : null,
    nextId: more && last ? last.id : null,
  };
}

/** How many problems of each severity the filter matches. Every severity is present, so a zero is stated, not missing. */
export function countProblemsBySeverity(db: Db, filter: ProblemFilter): Record<ProblemSeverity, number> {
  const counts = Object.fromEntries(PROBLEM_SEVERITIES.map((severity) => [severity, 0])) as Record<ProblemSeverity, number>;
  const rows = db
    .select({ severity: problems.severity, total: sql<number>`count(*)` })
    .from(problems)
    .where(and(...conditions(filter)))
    .groupBy(problems.severity)
    .all();
  for (const row of rows) counts[row.severity] = Number(row.total);
  return counts;
}

/**
 * The projection the pure lifecycle layer works on. `detect` may not import the schema, so the row is
 * narrowed here to exactly the fields the rules read — which is also a useful discipline: a rule that needs
 * a new field has to say so.
 */
function toLive(row: ProblemRow): LiveProblem {
  return {
    id: row.id,
    key: row.key,
    status: row.status,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    lastEvaluatedAt: row.lastEvaluatedAt,
    clearStreak: row.clearStreak,
    clearSinceAt: row.clearSinceAt,
    occurrences: row.occurrences,
    flapCount: row.flapCount,
    resolvedAt: row.resolvedAt,
  };
}

/** Every problem still open in one environment, with the row kept beside its projection. */
export function listLiveProblems(db: Db, connectionId: string, scope: string): { row: ProblemRow; live: LiveProblem }[] {
  return db
    .select()
    .from(problems)
    .where(and(eq(problems.connectionId, connectionId), eq(problems.scope, scope), isNull(problems.resolvedAt)))
    .orderBy(asc(problems.seq))
    .all()
    .map((row) => ({ row, live: toLive(row) }));
}

/** Rows resolved recently enough that trouble returning should continue them rather than start again. */
export function listRecentlyResolved(db: Db, connectionId: string, scope: string, notBeforeMs: number): LiveProblem[] {
  return db
    .select()
    .from(problems)
    .where(
      and(
        eq(problems.connectionId, connectionId),
        eq(problems.scope, scope),
        isNotNull(problems.resolvedAt),
        gte(problems.resolvedAt, notBeforeMs),
      ),
    )
    .orderBy(desc(problems.resolvedAt))
    .all()
    .map(toLive);
}

/** What the detector knew about a subject, kept beside the transition so the store can write the row. */
export type ProblemContext = { connectionId: string; scope: string };

function scoredFields(problem: DetectedProblem, firstSeenAt: number, nowMs: number) {
  const terms = scoreProblem({
    level: problem.level,
    blast: problem.blast,
    minutesBreaching: problem.minutesBreaching,
    userFacing: problem.userFacing,
    robustZ: problem.robustZ,
    subjectFirstSeenAt: firstSeenAt,
    nowMs,
    ...(problem.totalFailure === undefined ? {} : { totalFailure: problem.totalFailure }),
    ...(problem.floorCritical === undefined ? {} : { floorCritical: problem.floorCritical }),
  });
  return { score: terms.score, severity: severityForScore(terms.score), scoreTerms: terms };
}

/**
 * Applies one cycle's transitions. Answers how many problems are open afterwards, which is what the collector
 * records as the job's coverage.
 *
 * Each transition is one small transaction rather than one large one: §9.2's rule is that the event loop keeps
 * serving pages, and a cycle that opened two hundred problems inside a single transaction would not.
 */
export function applyTransitions(db: Db, context: ProblemContext, transitions: readonly Transition[]): number {
  /**
   * A transition is something that happened, so it goes on the append-only spine (§9.3) as well as changing
   * the row. This is what lets the Morning brief say what *changed* since someone last looked, without
   * reading AWS a second time. The dedupe key makes a repeated cycle a no-op rather than a duplicate.
   */
  const note = (kind: 'problem_opened' | 'problem_reopened' | 'problem_resolved', id: string, at: number, row: ProblemRow | null) => {
    appendEvent(db, {
      at,
      connectionId: context.connectionId,
      scope: context.scope,
      kind,
      subjectType: row?.subjectType ?? 'service',
      subjectId: row?.subjectId ?? id,
      serviceId: row?.serviceId ?? null,
      severity: row?.severity ?? null,
      source: 'aws',
      payload: { problemId: id, ...(row === null ? {} : { titleKey: row.titleKey, score: row.score }) },
      dedupeKey: `${kind}:${id}:${at}`,
    });
  };

  for (const transition of transitions) {
    switch (transition.type) {
      case 'open': {
        const { problem, at } = transition;
        const opened = insertProblem(db, {
          key: transition.key,
          connectionId: context.connectionId,
          scope: context.scope,
          kind: problem.kind,
          subjectType: problem.subject.type,
          subjectId: problem.subject.id,
          subjectName: problem.subject.name,
          serviceId: problem.subject.serviceId,
          source: 'aws',
          titleKey: problem.titleKey,
          values: problem.values,
          href: problem.href,
          firstSeenAt: at,
          lastSeenAt: at,
          lastEvaluatedAt: at,
          previousProblemId: transition.previousProblemId,
          evidence: problem.evidence,
          ...scoredFields(problem, at, at),
        });
        note('problem_opened', opened.id, at, opened);
        break;
      }
      case 'reopen': {
        const { problem, at, id } = transition;
        const existing = findProblemById(db, id);
        const firstSeenAt = existing?.firstSeenAt ?? at;
        db.transaction(() => {
          updateProblem(db, id, {
            status: 'open',
            resolvedAt: null,
            lastSeenAt: at,
            lastEvaluatedAt: at,
            clearStreak: 0,
            clearSinceAt: null,
            occurrences: (existing?.occurrences ?? 0) + 1,
            // The flap is the point of reopening rather than starting again: it is how a service that comes
            // and goes is told from one that broke once.
            flapCount: (existing?.flapCount ?? 0) + 1,
            ...scoredFields(problem, firstSeenAt, at),
          });
          replaceEvidence(db, id, problem.evidence);
        });
        note('problem_reopened', id, at, findProblemById(db, id));
        break;
      }
      case 'touch': {
        const { problem, at, id } = transition;
        const existing = findProblemById(db, id);
        const firstSeenAt = existing?.firstSeenAt ?? at;
        db.transaction(() => {
          updateProblem(db, id, {
            lastSeenAt: at,
            lastEvaluatedAt: at,
            occurrences: (existing?.occurrences ?? 0) + 1,
            ...(transition.resetClear ? { clearStreak: 0, clearSinceAt: null } : {}),
            ...scoredFields(problem, firstSeenAt, at),
          });
          // The bundle is the current argument for the problem, so it is restated rather than appended to.
          replaceEvidence(db, id, problem.evidence);
        });
        break;
      }
      case 'progress_clear':
        updateProblem(db, transition.id, {
          lastEvaluatedAt: transition.at,
          clearStreak: transition.clearStreak,
          clearSinceAt: transition.clearSinceAt,
        });
        break;
      case 'resolve': {
        const resolved = updateProblem(db, transition.id, {
          status: 'resolved',
          resolvedAt: transition.at,
          lastEvaluatedAt: transition.at,
        });
        note('problem_resolved', transition.id, transition.at, resolved);
        break;
      }
    }
  }
  return db
    .select({ id: problems.id })
    .from(problems)
    .where(and(eq(problems.connectionId, context.connectionId), eq(problems.scope, context.scope), isNull(problems.resolvedAt)))
    .all().length;
}

/**
 * What a period looked like: problems that **opened** in it and problems that **resolved** in it, by severity
 * (§19). The two are counted independently and neither implies the other — a problem may open in one period
 * and resolve three periods later, and a report that netted them off would hide exactly that.
 *
 * `kinds` scopes the count to one family's detectors, which is how a section's report covers its own section
 * and nothing else. Omitting it counts the whole environment.
 */
export type WindowCounts = {
  opened: Record<ProblemSeverity, number>;
  resolved: Record<ProblemSeverity, number>;
};

export function countProblemsInWindow(
  db: Db,
  filter: { connectionId: string; scope: string; kinds?: readonly string[] },
  window: { from: number; to: number },
): WindowCounts {
  const zero = () => Object.fromEntries(PROBLEM_SEVERITIES.map((severity) => [severity, 0])) as Record<ProblemSeverity, number>;
  const counts: WindowCounts = { opened: zero(), resolved: zero() };
  // An empty `kinds` is "no detector belongs to this family", which is genuinely zero rather than everything.
  if (filter.kinds !== undefined && filter.kinds.length === 0) return counts;

  const scoped = [eq(problems.connectionId, filter.connectionId), eq(problems.scope, filter.scope)];
  if (filter.kinds !== undefined) scoped.push(inArray(problems.kind, [...filter.kinds]));

  // Half-open [from, to): an instant belongs to exactly one period, so consecutive reports never double-count.
  const openedRows = db
    .select({ severity: problems.severity, total: sql<number>`count(*)` })
    .from(problems)
    .where(and(...scoped, gte(problems.firstSeenAt, window.from), lt(problems.firstSeenAt, window.to)))
    .groupBy(problems.severity)
    .all();
  for (const row of openedRows) counts.opened[row.severity] = Number(row.total);

  const resolvedRows = db
    .select({ severity: problems.severity, total: sql<number>`count(*)` })
    .from(problems)
    .where(and(...scoped, isNotNull(problems.resolvedAt), gte(problems.resolvedAt, window.from), lt(problems.resolvedAt, window.to)))
    .groupBy(problems.severity)
    .all();
  for (const row of resolvedRows) counts.resolved[row.severity] = Number(row.total);

  return counts;
}

/** The subjects that opened the most problems in a window — §19's "worst resources", newest severity kept. */
export function worstSubjectsInWindow(
  db: Db,
  filter: { connectionId: string; scope: string; kinds?: readonly string[] },
  window: { from: number; to: number },
  limit: number,
): { subjectId: string; subjectName: string; severity: ProblemSeverity; total: number }[] {
  if (filter.kinds !== undefined && filter.kinds.length === 0) return [];
  const scoped = [eq(problems.connectionId, filter.connectionId), eq(problems.scope, filter.scope)];
  if (filter.kinds !== undefined) scoped.push(inArray(problems.kind, [...filter.kinds]));

  return db
    .select({
      subjectId: problems.subjectId,
      subjectName: sql<string>`min(${problems.subjectName})`,
      // The worst severity the subject reached, which is what makes it worth listing.
      severity: sql<ProblemSeverity>`min(case ${problems.severity} when 'critical' then 1 when 'warning' then 2 else 3 end)`,
      total: sql<number>`count(*)`,
    })
    .from(problems)
    .where(and(...scoped, gte(problems.firstSeenAt, window.from), lt(problems.firstSeenAt, window.to)))
    .groupBy(problems.subjectId)
    .orderBy(desc(sql`count(*)`), asc(problems.subjectId))
    .limit(limit)
    .all()
    .map((row) => ({
      ...row,
      // The rank came back as the ordinal the CASE produced; turn it back into the word.
      severity: (['critical', 'warning', 'info'] as const)[Number(row.severity) - 1] ?? 'info',
    }));
}
