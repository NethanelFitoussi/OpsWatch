import { describe, expect, it } from 'vitest';
import { runDetectors, type Detector, type DetectorInput } from '@/lib/detect/framework';
import {
  EVIDENCE_KINDS,
  outcomeKeyParts,
  type Evidence,
  type EvidenceKind,
  type SubjectOutcome,
  type SubjectRef,
} from '@/lib/detect/types';
import { EVIDENCE_KINDS as SCHEMA_EVIDENCE_KINDS } from '@/lib/db/schema';
import { detected } from '../helpers/detect';

const NOW = Date.UTC(2026, 8, 19, 9, 0, 0);

const subject = (id: string): SubjectRef => ({ type: 'service', id, name: id, serviceId: id });
const input: DetectorInput = { subjects: [subject('prod/web'), subject('prod/api')], nowMs: NOW };

const firing = (id: string, kind: string): Detector => ({
  id: kind,
  evaluate: () => [{ state: 'fired', kind, subject: subject(id), problem: detected({ kind, subjectId: id }) }],
});

const clear = (id: string, kind: string): Detector => ({
  id: kind,
  evaluate: () => [{ state: 'clear', kind, subject: subject(id) }],
});

const throwing = (kind: string): Detector => ({
  id: kind,
  evaluate: () => {
    throw new Error('the rule is broken');
  },
});

describe('the detector vocabulary', () => {
  it('knows the same evidence kinds the store does, without importing the store to find out', () => {
    expect([...EVIDENCE_KINDS]).toEqual([...SCHEMA_EVIDENCE_KINDS]);
  });

  it.each(EVIDENCE_KINDS)('carries a %s measurement, with null meaning not measured', (kind: EvidenceKind) => {
    // §2.4: a missing measurement is null and renders as "not measured". It is never written as 0, because
    // a zero is a reading and an absence is not, and a page that showed them alike would be lying.
    const measured: Evidence = { kind, labelKey: 'Problems.evidence.cpu', values: {}, value: 96.2, unit: 'percent', at: NOW };
    const absent: Evidence = { ...measured, value: null, unit: null };
    expect(measured.value).toBe(96.2);
    expect(absent.value).toBeNull();
    expect(absent.value).not.toBe(0);
  });

  it('requires at least one piece of evidence to have fired at all', () => {
    // §4.3: "A problem with no evidence cannot be created; the type makes the field required." The tuple type
    // is what enforces it at compile time; this records the intent for a reader.
    expect(detected().evidence.length).toBeGreaterThan(0);
  });

  it('maps an outcome to the parts its problem key is built from', () => {
    expect(outcomeKeyParts({ state: 'clear', kind: 'ecs_cpu_high', subject: subject('prod/web') })).toEqual({
      kind: 'ecs_cpu_high',
      subjectId: 'prod/web',
    });
  });
});

describe('running a cycle of detectors', () => {
  it('collects every outcome and stamps the cycle with the clock it was given', () => {
    const cycle = runDetectors([firing('prod/web', 'ecs_cpu_high'), clear('prod/api', 'ecs_memory_high')], input);
    expect(cycle.at).toBe(NOW);
    expect(cycle.outcomes).toHaveLength(2);
    expect(cycle.failed).toEqual([]);
  });

  it('tags each outcome with the detector that produced it', () => {
    const cycle = runDetectors([firing('prod/web', 'ecs_cpu_high'), clear('prod/web', 'ecs_memory_high')], input);
    // Two outcomes about the same subject must stay distinguishable, or they would collapse onto one key.
    expect(cycle.outcomes.map((outcome) => outcome.kind)).toEqual(['ecs_cpu_high', 'ecs_memory_high']);
  });

  it('answers an empty cycle for no detectors, rather than pretending everything is clear', () => {
    const cycle = runDetectors([], input);
    expect(cycle.outcomes).toEqual([]);
    expect(cycle.failed).toEqual([]);
  });

  it('isolates a detector that throws: the others still run', () => {
    const cycle = runDetectors([firing('prod/web', 'ecs_cpu_high'), throwing('broken'), clear('prod/api', 'rds_cpu_high')], input);
    expect(cycle.failed).toEqual(['broken']);
    expect(cycle.outcomes.filter((outcome) => outcome.state === 'fired')).toHaveLength(1);
    expect(cycle.outcomes.filter((outcome) => outcome.state === 'clear')).toHaveLength(1);
  });

  it('records the broken detector\'s subjects as not-evaluated, never as clear', () => {
    // This is the §33.5 hazard: an omitted subject would be counted as healthy by anything that counts what it
    // sees, and the problem would auto-resolve because a rule crashed.
    const cycle = runDetectors([throwing('broken')], input);
    const states = cycle.outcomes.filter((outcome) => outcome.kind === 'broken').map((outcome) => outcome.state);
    expect(states).toEqual(['not_evaluated', 'not_evaluated']);
    expect(cycle.outcomes.some((outcome) => outcome.state === 'clear')).toBe(false);
  });

  it('keeps going when every detector throws', () => {
    const cycle = runDetectors([throwing('a'), throwing('b')], input);
    expect(cycle.failed).toEqual(['a', 'b']);
    expect(cycle.outcomes).toHaveLength(4);
  });

  it('is pure: the same input twice gives the same outcomes', () => {
    const detectors = [firing('prod/web', 'ecs_cpu_high'), clear('prod/api', 'rds_cpu_high')];
    expect(runDetectors(detectors, input)).toEqual(runDetectors(detectors, input));
  });

  it('does not let a detector report under another detector\'s name', () => {
    const liar: Detector = {
      id: 'honest',
      evaluate: (): SubjectOutcome[] => [{ state: 'clear', kind: '', subject: subject('prod/web') }],
    };
    // An outcome that names no detector is attributed to the one that produced it, not left blank.
    expect(runDetectors([liar], input).outcomes[0].kind).toBe('honest');
  });
});
