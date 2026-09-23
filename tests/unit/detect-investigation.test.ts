import { describe, expect, it } from 'vitest';
import {
  CORRELATION_WINDOW_MS,
  DEPLOYMENT_WINDOW_MS,
  FLAP_THRESHOLD,
  FLAP_WINDOW_MS,
  NOT_EVALUATED,
  correlationsFor,
  factsFrom,
  hypothesesFor,
  relationBetween,
  type EventLike,
  type Confidence,
  type Fact,
} from '@/lib/detect/investigation';

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const MINUTE = 60_000;

const event = (over: Partial<EventLike> = {}): EventLike => ({
  id: 'e1',
  at: NOW,
  kind: 'problem_opened',
  subjectId: 'prod/web',
  serviceId: 'prod/web',
  payload: {},
  ...over,
});

const fact = (over: Partial<Fact> = {}): Fact => ({
  id: 'f1',
  at: NOW,
  type: 'problem_opened',
  subjectId: 'prod/web',
  serviceId: 'prod/web',
  values: {},
  ...over,
});

const problem = { kind: 'ecs_cpu_high', firstSeenAt: NOW, reopensInWindow: 0, serviceId: 'prod/web' };

describe('band 1 — observed facts, never inferred', () => {
  it('THE RULING: one event becomes one fact, and nothing else becomes a fact at all', () => {
    // The function takes events and nothing else, so there is no path by which something unobserved
    // could enter the timeline as a fact.
    const facts = factsFrom([event({ id: 'a' }), event({ id: 'b', at: NOW - MINUTE })]);
    expect(facts).toHaveLength(2);
    expect(facts.map((one) => one.id)).toEqual(['b', 'a']);
  });

  it('carries the event kind through, so a fact can be traced back to its row', () => {
    expect(factsFrom([event({ kind: 'deployment_started' })])[0]?.type).toBe('deployment_started');
  });

  it('keeps only placeholder values, never a payload object a client cannot render', () => {
    const facts = factsFrom([event({ payload: { taskDefinition: 'web:42', count: 3, nested: { a: 1 }, missing: null } })]);
    expect(facts[0]?.values).toEqual({ taskDefinition: 'web:42', count: 3 });
  });

  it('orders oldest first, with a stable tiebreak', () => {
    const facts = factsFrom([event({ id: 'z' }), event({ id: 'a' })]);
    expect(facts.map((one) => one.id)).toEqual(['a', 'z']);
  });
});

describe('band 2 — correlations, which state a gap and never a cause', () => {
  it('measures the gap in minutes, which is the entire claim', () => {
    const anchor = fact({ id: 'anchor' });
    const [correlation] = correlationsFor(anchor, [fact({ id: 'other', at: NOW - 8 * MINUTE })]);
    expect(correlation).toMatchObject({ minutesApart: 8, relation: 'same_subject' });
    // The earlier of the two is named as earlier; nothing in the shape says one produced the other.
    expect(correlation?.earlier.id).toBe('other');
    expect(correlation).not.toHaveProperty('cause');
  });

  it('THE RULING: without a declared relation there is no correlation, however close in time', () => {
    const anchor = fact({ id: 'anchor', subjectId: 'prod/web', serviceId: 'prod/web' });
    const unrelated = fact({ id: 'other', subjectId: 'prod/db', serviceId: 'prod/db', at: NOW - MINUTE });
    expect(relationBetween(anchor, unrelated)).toBeNull();
    // Otherwise everything happening at once in a busy account looks correlated.
    expect(correlationsFor(anchor, [unrelated])).toEqual([]);
  });

  it('relates by subject, and failing that by service', () => {
    const anchor = fact({ subjectId: 'a', serviceId: 'prod/web' });
    expect(relationBetween(anchor, fact({ subjectId: 'a', serviceId: null }))).toBe('same_subject');
    expect(relationBetween(anchor, fact({ subjectId: 'b', serviceId: 'prod/web' }))).toBe('same_service');
  });

  it('never relates two facts that both have no service', () => {
    const a = fact({ id: 'a', subjectId: 'x', serviceId: null });
    const b = fact({ id: 'b', subjectId: 'y', serviceId: null });
    expect(relationBetween(a, b)).toBeNull();
  });

  it('drops a fact outside the window', () => {
    const anchor = fact({ id: 'anchor' });
    expect(correlationsFor(anchor, [fact({ id: 'far', at: NOW - 16 * MINUTE })])).toEqual([]);
    expect(correlationsFor(anchor, [fact({ id: 'near', at: NOW - 15 * MINUTE })])).toHaveLength(1);
  });

  it('THE RULING: a deployment keeps its wider window, because §5 says thirty minutes still counts', () => {
    const anchor = fact({ id: 'anchor' });
    const deployed = fact({ id: 'dep', type: 'deployment_started', at: NOW - 25 * MINUTE });
    expect(correlationsFor(anchor, [deployed])).toHaveLength(1);
    expect(DEPLOYMENT_WINDOW_MS).toBeGreaterThan(CORRELATION_WINDOW_MS);
  });

  it('does not correlate a fact with itself', () => {
    const anchor = fact({ id: 'anchor' });
    expect(correlationsFor(anchor, [anchor])).toEqual([]);
  });

  it('puts the nearest pair first', () => {
    const anchor = fact({ id: 'anchor' });
    const list = correlationsFor(anchor, [fact({ id: 'a', at: NOW - 10 * MINUTE }), fact({ id: 'b', at: NOW - 2 * MINUTE })]);
    expect(list.map((one) => one.minutesApart)).toEqual([2, 10]);
  });
});

describe('band 3 — hypotheses, from a fixed catalogue', () => {
  const deployment = fact({ id: 'dep', type: 'deployment_started', at: NOW - 10 * MINUTE });
  const errorSignal = fact({ id: 'err', type: 'error_group_appeared', at: NOW - 3 * MINUTE });

  it('§5 — a deployment plus an error signal is high; the deployment alone is medium', () => {
    const anchor = fact({ id: 'anchor' });
    const withBoth = hypothesesFor(problem, [deployment, errorSignal], correlationsFor(anchor, [deployment, errorSignal]));
    expect(withBoth[0]).toMatchObject({ id: 'deploy_regression', confidence: 'high' });

    const withOne = hypothesesFor(problem, [deployment], correlationsFor(anchor, [deployment]));
    expect(withOne[0]).toMatchObject({ id: 'deploy_regression', confidence: 'medium' });
  });

  it('names the facts it rests on, so the reasoning can be checked rather than trusted', () => {
    const anchor = fact({ id: 'anchor' });
    const [hypothesis] = hypothesesFor(problem, [deployment, errorSignal], correlationsFor(anchor, [deployment, errorSignal]));
    expect(hypothesis?.supporting).toContain('err');
    expect(hypothesis?.confirmedBy).toBeTruthy();
  });

  it('THE RULING: capacity shortfall requires the ABSENCE of a deployment', () => {
    const shortfall = { ...problem, kind: 'ecs_tasks_below_desired' };
    const anchor = fact({ id: 'anchor' });

    expect(hypothesesFor(shortfall, [], []).map((one) => one.id)).toEqual(['capacity_shortfall']);
    // The same symptom during a rollout is a deployment in progress, not a capacity problem.
    const during = hypothesesFor(shortfall, [deployment], correlationsFor(anchor, [deployment]));
    expect(during.map((one) => one.id)).not.toContain('capacity_shortfall');
  });

  it('§5 — flapping with nothing else is noise, and only with nothing else', () => {
    const flapping = { ...problem, reopensInWindow: FLAP_THRESHOLD };
    expect(hypothesesFor(flapping, [], []).map((one) => one.id)).toContain('noise');
    // With any other fact present, the flapping is not the only thing to explain.
    expect(hypothesesFor(flapping, [errorSignal], []).map((one) => one.id)).not.toContain('noise');
  });

  it('THE RULING: the count is reopenings inside the window, not a lifetime total', () => {
    // §5 says "three times in 24 hours". A problem that flapped three times last March is not noise today,
    // and the lifetime column cannot tell the two apart — so the caller counts events in the window.
    const longAgo = { ...problem, reopensInWindow: 0 };
    expect(hypothesesFor(longAgo, [], []).map((one) => one.id)).not.toContain('noise');
    expect(hypothesesFor({ ...problem, reopensInWindow: FLAP_THRESHOLD - 1 }, [], []).map((one) => one.id)).not.toContain('noise');
    expect(FLAP_WINDOW_MS).toBe(24 * 60 * 60_000);
  });

  it('offers nothing when nothing in the catalogue matches, rather than guessing', () => {
    expect(hypothesesFor(problem, [], [])).toEqual([]);
  });

  it('ranks by confidence, then by how many facts support it (§7)', () => {
    const anchor = fact({ id: 'anchor' });
    const shortfall = { ...problem, kind: 'alb_unhealthy_hosts' };
    // No deployment, so capacity_shortfall (high) applies and deploy_regression does not.
    const list = hypothesesFor(shortfall, [errorSignal], correlationsFor(anchor, [errorSignal]));
    expect(list.map((one) => one.confidence)).toEqual([...list.map((one) => one.confidence)].sort());
  });

  it('speaks the same three confidences the contract does', () => {
    // The contract's evidence carries low | medium | high. A hypothesis whose confidence is not one of
    // them would fail to parse on the wire, on the row a reader most needs to weigh.
    const all: Confidence[] = ['high', 'medium', 'low'];
    const anchor = fact({ id: 'anchor' });
    const list = hypothesesFor({ ...problem, kind: 'ecs_tasks_below_desired' }, [deployment], correlationsFor(anchor, [deployment]));
    for (const hypothesis of list) expect(all).toContain(hypothesis.confidence);
  });

  it('THE RULING: the entries it cannot evaluate are declared, not quietly omitted', () => {
    // A reader must be able to see the catalogue was not fully run — the same rule as Checkup.
    expect([...NOT_EVALUATED]).toContain('traffic_surge');
    expect([...NOT_EVALUATED]).toContain('query_regression');
    expect(NOT_EVALUATED.length).toBeGreaterThan(0);
  });
});
