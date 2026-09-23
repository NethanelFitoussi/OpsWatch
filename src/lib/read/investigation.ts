import 'server-only';
import type { Evidence } from '@opswatch/contract';
import type { Db } from '../db/client';
import type { ProblemRow } from '../db/schema';
import {
  DEPLOYMENT_WINDOW_MS,
  FLAP_THRESHOLD,
  FLAP_WINDOW_MS,
  NOT_EVALUATED,
  correlationsFor,
  factsFrom,
  hypothesesFor,
  type Correlation,
  type Fact,
} from '../detect/investigation';
import { listEvents } from '../store/events';

/**
 * A problem's investigation timeline, in §7's three bands (INV-1, INV-3).
 *
 * Assembled from the events spine alone, so it costs nothing and works for a problem opened weeks ago. The
 * bands reach the wire as the contract's `kind` — `fact`, `correlation`, `hypothesis` — which every client
 * already has to keep visibly apart. That separation is the feature; merging them would let a guess inherit
 * the authority of a measurement.
 */

/** How far either side of the problem's start to gather facts from. */
const TIMELINE_WINDOW_MS = DEPLOYMENT_WINDOW_MS;
/** A bound, so an environment with a noisy hour cannot produce an unbounded timeline. */
export const TIMELINE_FACT_LIMIT = 100;

/** Renders a key in the caller's locale. The service never builds a sentence itself (§12.2). */
export type InvestigationLabels = {
  fact: (type: string, values: Record<string, string | number>) => string;
  correlation: (values: { minutes: number; relation: string; earlier: string; later: string }) => string;
  hypothesis: (id: string) => string;
  confirmedBy: (key: string) => string;
  notEvaluated: (ids: readonly string[]) => string;
};

export type Investigation = {
  timeline: Evidence[];
  /** Catalogue entries this build cannot evaluate, declared rather than omitted (§7, §2.6). */
  notEvaluated: readonly string[];
};

function factEvidence(fact: Fact, labels: InvestigationLabels): Evidence {
  return {
    id: `fact:${fact.id}`,
    at: fact.at,
    // Band 1. A fact carries no confidence, because it is not a judgement.
    kind: 'fact',
    type: fact.type,
    title: labels.fact(fact.type, fact.values),
  };
}

function correlationEvidence(correlation: Correlation, labels: InvestigationLabels): Evidence {
  return {
    id: `correlation:${correlation.id}`,
    at: correlation.at,
    kind: 'correlation',
    type: correlation.relation,
    // Band 2. The sentence names the measured gap and the relation; it cannot say "because" because the
    // message key it renders does not contain the word.
    title: labels.correlation({
      minutes: correlation.minutesApart,
      relation: correlation.relation,
      earlier: correlation.earlier.type,
      later: correlation.later.type,
    }),
  };
}

/**
 * How many times this problem reopened inside §5's window.
 *
 * Read from the events spine rather than from `problems.flapCount`, which is a lifetime total: the rule
 * says "three times in 24 hours", and a lifetime counter cannot answer that question.
 */
function countReopens(db: Db, problem: ProblemRow, nowMs: number): number {
  return listEvents(
    db,
    { connectionId: problem.connectionId, scope: problem.scope, sinceMs: nowMs - FLAP_WINDOW_MS, untilMs: nowMs },
    null,
    FLAP_THRESHOLD * 10,
  ).items.filter((event) => event.kind === 'problem_reopened' && event.payload.problemId === problem.id).length;
}

export function readInvestigation(db: Db, problem: ProblemRow, labels: InvestigationLabels, nowMs: number): Investigation {
  const events = listEvents(
    db,
    {
      connectionId: problem.connectionId,
      scope: problem.scope,
      sinceMs: problem.firstSeenAt - TIMELINE_WINDOW_MS,
      untilMs: problem.firstSeenAt + TIMELINE_WINDOW_MS,
    },
    null,
    TIMELINE_FACT_LIMIT,
  ).items;

  const facts = factsFrom(
    events.map((event) => ({
      id: event.id,
      at: event.at,
      kind: event.kind,
      subjectId: event.subjectId,
      serviceId: event.serviceId,
      payload: event.payload as Record<string, unknown>,
    })),
  );

  // The anchor is the problem itself, expressed as a fact so the relation rules apply to it unchanged.
  const anchor: Fact = {
    id: `problem:${problem.id}`,
    at: problem.firstSeenAt,
    type: 'problem_opened',
    subjectId: problem.subjectId,
    serviceId: problem.serviceId,
    values: {},
  };

  const correlations = correlationsFor(anchor, facts);
  const hypotheses = hypothesesFor(
    {
      kind: problem.kind,
      firstSeenAt: problem.firstSeenAt,
      // Counted over §5's window rather than taken from the lifetime column, so a problem that flapped last
      // March is not called noise today.
      reopensInWindow: countReopens(db, problem, nowMs),
      serviceId: problem.serviceId,
    },
    facts,
    correlations,
  );

  const timeline: Evidence[] = [
    ...facts.map((fact) => factEvidence(fact, labels)),
    ...correlations.map((correlation) => correlationEvidence(correlation, labels)),
    ...hypotheses.map((hypothesis) => ({
      id: `hypothesis:${hypothesis.id}`,
      at: problem.firstSeenAt,
      kind: 'hypothesis' as const,
      type: hypothesis.id,
      title: labels.hypothesis(hypothesis.id),
      // Band 3, and the only band that carries one: a confidence on a fact would be a category error.
      confidence: hypothesis.confidence,
      detail: labels.confirmedBy(hypothesis.confirmedBy),
    })),
  ];

  return { timeline, notEvaluated: NOT_EVALUATED };
}
