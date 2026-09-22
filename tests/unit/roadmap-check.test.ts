import { describe, expect, it } from 'vitest';
import { HUMAN_ACCEPTANCE, runChecks } from '../../scripts/roadmap-check';

/**
 * The checker guards against roadmap drift, so it needs its own guard: a check that silently stopped
 * looking would pass forever and be believed.
 */

describe('the repository has no structural roadmap drift', () => {
  it('THE RULING: every structural check passes on this tree', () => {
    const { failures } = runChecks();
    // Printed in full, because a failure here names exactly what drifted.
    expect(failures.map((failure) => `${failure.check}: ${failure.detail}`)).toEqual([]);
  });
});

describe('the checker actually looks at things', () => {
  const { notes } = runChecks();

  it('reports the capabilities that are not implemented, rather than staying silent about them', () => {
    const capabilities = notes.filter((note) => note.check === 'capabilities');
    // There are unimplemented capabilities today; a run that found none would mean the check stopped reading.
    expect(capabilities.length).toBeGreaterThan(0);
    expect(capabilities.some((note) => note.detail.includes('ai'))).toBe(true);
  });

  it('reports contract schemas nothing serves, which is the roadmap’s own backlog', () => {
    const producers = notes.filter((note) => note.check === 'schema-producers');
    expect(producers.length).toBeGreaterThan(0);
    // These are notes, never failures: the contract is allowed to describe more than the server serves.
    expect(runChecks().failures.some((failure) => failure.check === 'schema-producers')).toBe(false);
  });
});

describe('what the checker refuses to decide', () => {
  it('names the judgements only a person can make, so a green run is not read as "done"', () => {
    expect(HUMAN_ACCEPTANCE.length).toBeGreaterThanOrEqual(4);
    for (const question of HUMAN_ACCEPTANCE) expect(question.endsWith('?')).toBe(true);
  });

  it('never produces a completeness score', () => {
    const { failures, notes } = runChecks();
    const text = [...failures, ...notes].map((finding) => finding.detail).join(' ');
    // A percentage would be believed, and no script can measure whether a page tells the truth.
    expect(text).not.toMatch(/\d+\s*% (complete|done)/i);
  });
});

describe('it is deterministic, which is what makes it safe in CI', () => {
  it('gives the same answer twice', () => {
    expect(JSON.stringify(runChecks())).toBe(JSON.stringify(runChecks()));
  });
});
