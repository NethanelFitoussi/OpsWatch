import 'server-only';
import { and, asc, desc, eq, gt, gte, inArray, isNull, isNotNull, or, sql } from 'drizzle-orm';
import { randomId } from '../crypto';
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
