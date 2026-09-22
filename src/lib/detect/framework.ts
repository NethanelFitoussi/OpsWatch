import 'server-only';
import type { SubjectOutcome, SubjectRef } from './types';

/**
 * How a cycle of detectors is run (§5: "a detector is a pure function over fetched or stored data").
 *
 * The framework's one real job is **isolating failure**. Ten detectors run over the same fetched data; if the
 * ninth throws, the other nine must still report, and the subjects the ninth was given must be recorded as
 * `not_evaluated` rather than silently omitted — because §33.5 makes "not evaluated" mean something specific,
 * and an omission would be read as "clear" by any code that counts what it sees.
 */
export type DetectorInput = {
  /** Every subject this cycle is evaluating. A detector reports an outcome for the ones it knows about. */
  subjects: readonly SubjectRef[];
  nowMs: number;
};

export type Detector = {
  id: string;
  /** Pure: same input, same outcomes. It may not call AWS, read a clock or touch the database. */
  evaluate: (input: DetectorInput) => SubjectOutcome[];
};

export type DetectorCycle = {
  at: number;
  outcomes: SubjectOutcome[];
  /** The detectors that threw, so the collector can record `collector_job_failed` without inventing a reason. */
  failed: string[];
};

/**
 * Runs every detector over one input and collects the outcomes.
 *
 * Each outcome is tagged with the detector that produced it, so a detector cannot report on another's behalf
 * and the lifecycle can line an outcome up against the right problem key.
 */
export function runDetectors(detectors: readonly Detector[], input: DetectorInput): DetectorCycle {
  const outcomes: SubjectOutcome[] = [];
  const failed: string[] = [];
  for (const detector of detectors) {
    try {
      for (const outcome of detector.evaluate(input)) {
        outcomes.push({ ...outcome, kind: outcome.kind || detector.id });
      }
    } catch {
      // Nothing about the failure is logged here: this layer is pure, and the collector owns the log line.
      failed.push(detector.id);
      for (const subject of input.subjects) {
        outcomes.push({ state: 'not_evaluated', kind: detector.id, subject });
      }
    }
  }
  return { at: input.nowMs, outcomes, failed };
}
