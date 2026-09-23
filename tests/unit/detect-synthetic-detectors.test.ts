import { describe, expect, it } from 'vitest';
import { syntheticOutcomes, type SyntheticSubject } from '@/lib/detect/synthetic-detectors';

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const MINUTE = 60_000;
const DAY = 24 * 60 * 60_000;

const subject = (over: Partial<SyntheticSubject> = {}): SyntheticSubject => ({
  id: 's1',
  name: 'Checkout health',
  url: 'https://example.com/healthz',
  latencyThresholdMs: 1000,
  runs: [
    { at: NOW - MINUTE, ok: true, totalMs: 120 },
    { at: NOW - 2 * MINUTE, ok: true, totalMs: 130 },
  ],
  certificateExpiresAt: NOW + 90 * DAY,
  ...over,
});

const stateOf = (outcomes: ReturnType<typeof syntheticOutcomes>, kind: string) =>
  outcomes.find((outcome) => outcome.kind === kind)?.state;

describe('§33.5 — a synthetic detector obeys the three outcomes', () => {
  it('THE RULING: a check that has never run is not evaluated, never clear', () => {
    // Recording it as clear would let the lifecycle resolve a problem on a measurement nobody made.
    const outcomes = syntheticOutcomes(subject({ runs: [] }), NOW);
    expect(outcomes.map((outcome) => outcome.state)).toEqual(['not_evaluated', 'not_evaluated', 'not_evaluated']);
  });

  it('is clear when it was looked at and found healthy', () => {
    const outcomes = syntheticOutcomes(subject(), NOW);
    expect(stateOf(outcomes, 'synthetic_down')).toBe('clear');
    expect(stateOf(outcomes, 'synthetic_slow')).toBe('clear');
    expect(stateOf(outcomes, 'cert_expiring')).toBe('clear');
  });
});

describe('synthetic_down', () => {
  it('fires after two consecutive failures, as a critical problem', () => {
    const failing = subject({ runs: [{ at: NOW, ok: false, totalMs: null }, { at: NOW - MINUTE, ok: false, totalMs: null }] });
    const outcome = syntheticOutcomes(failing, NOW).find((one) => one.kind === 'synthetic_down');
    expect(outcome?.state).toBe('fired');
    if (outcome?.state === 'fired') {
      expect(outcome.problem).toMatchObject({ level: 'critical', kind: 'synthetic_down' });
      // §4.3: a problem with no evidence cannot exist, and the type enforces it.
      expect(outcome.problem.evidence.length).toBeGreaterThan(0);
    }
  });

  it('does not fire on one failure', () => {
    const blip = subject({ runs: [{ at: NOW, ok: false, totalMs: null }, { at: NOW - MINUTE, ok: true, totalMs: 100 }] });
    expect(stateOf(syntheticOutcomes(blip, NOW), 'synthetic_down')).toBe('clear');
  });
});

describe('synthetic_slow', () => {
  it('fires as a warning when the median is over the threshold', () => {
    const slow = subject({ runs: [{ at: NOW, ok: true, totalMs: 4000 }, { at: NOW - MINUTE, ok: true, totalMs: 5000 }] });
    const outcome = syntheticOutcomes(slow, NOW).find((one) => one.kind === 'synthetic_slow');
    expect(outcome?.state).toBe('fired');
    if (outcome?.state === 'fired') expect(outcome.problem.level).toBe('warning');
  });

  it('THE RULING: with no threshold there is no question, so no verdict', () => {
    // Not clear: nobody said what "slow" means here, so nothing has been established either way.
    expect(stateOf(syntheticOutcomes(subject({ latencyThresholdMs: null }), NOW), 'synthetic_slow')).toBe('not_evaluated');
  });

  it('is not evaluated when no run measured a time', () => {
    const untimed = subject({ runs: [{ at: NOW, ok: false, totalMs: null }] });
    expect(stateOf(syntheticOutcomes(untimed, NOW), 'synthetic_slow')).toBe('not_evaluated');
  });
});

describe('cert_expiring', () => {
  it('warns at three weeks and escalates inside one', () => {
    const warn = syntheticOutcomes(subject({ certificateExpiresAt: NOW + 20 * DAY }), NOW).find((one) => one.kind === 'cert_expiring');
    expect(warn?.state === 'fired' && warn.problem.level).toBe('warning');

    const critical = syntheticOutcomes(subject({ certificateExpiresAt: NOW + 3 * DAY }), NOW).find((one) => one.kind === 'cert_expiring');
    expect(critical?.state === 'fired' && critical.problem.level).toBe('critical');
  });

  it('THE RULING: no certificate is not a healthy certificate', () => {
    // A plain-HTTP check has none. Clear would claim something nobody measured.
    expect(stateOf(syntheticOutcomes(subject({ certificateExpiresAt: null }), NOW), 'cert_expiring')).toBe('not_evaluated');
  });

  it('reports days remaining, floored at zero for one already expired', () => {
    const expired = syntheticOutcomes(subject({ certificateExpiresAt: NOW - 5 * DAY }), NOW).find((one) => one.kind === 'cert_expiring');
    expect(expired?.state === 'fired' && expired.problem.values.days).toBe(0);
  });
});

describe('the shape the lifecycle needs', () => {
  it('gives every outcome a subject and a kind, so it can be lined up against a live row', () => {
    for (const outcome of syntheticOutcomes(subject(), NOW)) {
      expect(outcome.subject.type).toBe('synthetic');
      expect(outcome.kind).toBeTruthy();
    }
  });

  it('treats a synthetic check as user-facing, because somebody pointed it at an endpoint users reach', () => {
    const failing = subject({ runs: [{ at: NOW, ok: false, totalMs: null }, { at: NOW - MINUTE, ok: false, totalMs: null }] });
    const outcome = syntheticOutcomes(failing, NOW).find((one) => one.kind === 'synthetic_down');
    expect(outcome?.state === 'fired' && outcome.problem.userFacing).toBe('direct');
  });
});
