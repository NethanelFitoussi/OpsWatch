import { describe, expect, it } from 'vitest';
import {
  CERT_CRITICAL_DAYS,
  CERT_WARNING_DAYS,
  FAILURES_TO_DOWN,
  LATENCY_SAMPLE,
  MAX_PATTERN_LENGTH,
  certificateSeverity,
  evaluateAssertion,
  isSlow,
  medianLatency,
  runPassed,
  statusFrom,
  type RunOutcome,
} from '@/lib/detect/synthetic';

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const MINUTE = 60_000;
const DAY = 24 * 60 * 60_000;
const run = (minutesAgo: number, ok: boolean, totalMs: number | null = 100): RunOutcome => ({ at: NOW - minutesAgo * MINUTE, ok, totalMs });

describe('§14 — one observation is not a fact', () => {
  it('THE RULING: a check that has never run is unknown, not up', () => {
    // Showing an unrun check as up is the most consequential lie this feature could tell.
    expect(statusFrom([])).toBe('unknown');
  });

  it('THE RULING: one failure is a blip, two in a row is an outage', () => {
    expect(statusFrom([run(1, false), run(2, true)])).toBe('up');
    expect(statusFrom([run(1, false), run(2, false)])).toBe('down');
    expect(FAILURES_TO_DOWN).toBe(2);
  });

  it('recovers on one success, because a stale "down" stops people believing the board', () => {
    expect(statusFrom([run(1, true), run(2, false), run(3, false)])).toBe('up');
  });

  it('reads the newest run first, whatever order it is given them in', () => {
    expect(statusFrom([run(3, false), run(1, true), run(2, false)])).toBe('up');
  });
});

describe('§14 — latency is a median, not a reading', () => {
  it('takes the median of the last five', () => {
    const runs = [run(1, true, 100), run(2, true, 200), run(3, true, 300), run(4, true, 400), run(5, true, 500)];
    expect(medianLatency(runs)).toBe(300);
    expect(LATENCY_SAMPLE).toBe(5);
  });

  it('THE RULING: one slow run does not move the median', () => {
    // A neighbour's backup job is not an outage, and a tool that pages on one is a tool people turn off.
    const runs = [run(1, true, 9000), run(2, true, 100), run(3, true, 110), run(4, true, 120), run(5, true, 130)];
    expect(medianLatency(runs)).toBe(120);
    expect(isSlow(runs, 1000)).toBe(false);
  });

  it('averages the two middle values on an even sample', () => {
    expect(medianLatency([run(1, true, 100), run(2, true, 200)])).toBe(150);
  });

  it('ignores runs that measured nothing rather than reading them as instant', () => {
    expect(medianLatency([run(1, false, null), run(2, true, 500)])).toBe(500);
    expect(medianLatency([run(1, false, null)])).toBeNull();
  });

  it('is never slow without a threshold somebody set', () => {
    expect(isSlow([run(1, true, 9000)], null)).toBe(false);
    expect(isSlow([run(1, true, 9000)], 1000)).toBe(true);
  });
});

describe('§14 — certificates', () => {
  it('warns at three weeks and escalates at one', () => {
    expect(certificateSeverity(NOW + 30 * DAY, NOW)).toBeNull();
    expect(certificateSeverity(NOW + 20 * DAY, NOW)).toBe('warning');
    expect(certificateSeverity(NOW + 5 * DAY, NOW)).toBe('critical');
    expect(certificateSeverity(NOW - DAY, NOW)).toBe('critical');
    expect({ CERT_WARNING_DAYS, CERT_CRITICAL_DAYS }).toEqual({ CERT_WARNING_DAYS: 21, CERT_CRITICAL_DAYS: 7 });
  });

  it('THE RULING: no certificate is not a healthy certificate', () => {
    // A plain-HTTP check has none. Reporting that as fine would be as wrong as reporting it as expiring.
    expect(certificateSeverity(null, NOW)).toBeNull();
  });
});

describe('§14 — assertions', () => {
  const response = { status: 200, body: 'hello world' };

  it('checks a status against a set or a range', () => {
    expect(evaluateAssertion({ kind: 'status_in', values: [200, 204] }, response).ok).toBe(true);
    expect(evaluateAssertion({ kind: 'status_in', values: [301] }, response).ok).toBe(false);
    expect(evaluateAssertion({ kind: 'status_range', from: 200, to: 299 }, response).ok).toBe(true);
    expect(evaluateAssertion({ kind: 'status_range', from: 300, to: 399 }, response).ok).toBe(false);
  });

  it('checks a body for what should and should not be there', () => {
    expect(evaluateAssertion({ kind: 'body_contains', value: 'hello' }, response).ok).toBe(true);
    expect(evaluateAssertion({ kind: 'body_excludes', value: 'error' }, response).ok).toBe(true);
    expect(evaluateAssertion({ kind: 'body_excludes', value: 'hello' }, response).ok).toBe(false);
    expect(evaluateAssertion({ kind: 'body_matches', value: '^hello' }, response).ok).toBe(true);
  });

  it('THE RULING: an assertion nobody could check is not an assertion that failed', () => {
    // §2.6 again. Treating it as failure would page somebody for a missing measurement.
    expect(evaluateAssertion({ kind: 'body_contains', value: 'x' }, { status: 500, body: null }).reason).toBe('not_evaluated');
    expect(evaluateAssertion({ kind: 'status_in', values: [200] }, { status: null, body: 'x' }).reason).toBe('not_evaluated');
  });

  it('THE RULING: a pattern that does not compile leaves it unevaluated, not failed', () => {
    // An operator's typo must not take a check down.
    expect(evaluateAssertion({ kind: 'body_matches', value: '([' }, response).reason).toBe('not_evaluated');
  });

  it('refuses an over-long pattern rather than running it', () => {
    const huge = 'a'.repeat(MAX_PATTERN_LENGTH + 1);
    expect(evaluateAssertion({ kind: 'body_matches', value: huge }, response).reason).toBe('not_evaluated');
  });
});

describe('whether a run passed', () => {
  const passed = { assertion: { kind: 'body_contains' as const, value: 'a' }, ok: true, reason: 'passed' as const };
  const failed = { assertion: { kind: 'body_contains' as const, value: 'b' }, ok: false, reason: 'failed' as const };
  const skipped = { assertion: { kind: 'body_contains' as const, value: 'c' }, ok: false, reason: 'not_evaluated' as const };

  it('passes when every evaluated assertion passed', () => {
    expect(runPassed([passed, passed])).toBe(true);
    expect(runPassed([passed, skipped])).toBe(true);
    expect(runPassed([passed, failed])).toBe(false);
  });

  it('THE RULING: a run where nothing could be evaluated is not a pass', () => {
    // It measured nothing, which is a different thing from having measured success.
    expect(runPassed([skipped, skipped])).toBe(false);
    expect(runPassed([])).toBe(false);
  });
});
