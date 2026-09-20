import 'server-only';
import type { SubjectKind } from './key';
import type { DetectorLevel, UserFacing } from './score';

/**
 * The vocabulary the pure layer speaks.
 *
 * It is declared here rather than imported from `@/lib/db/schema`, because `detect` may not depend on storage —
 * the store converts between the two. `tests/unit/detect-types.test.ts` asserts the lists still match, which is
 * what keeps them from drifting apart without tying the layers together.
 */
export const EVIDENCE_KINDS = ['metric', 'event', 'log', 'check', 'inventory'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/**
 * One thing a detector actually read. §4.3: "Evidence is what the detector actually read. A problem with no
 * evidence cannot be created; the type makes the field required."
 */
export type Evidence = {
  kind: EvidenceKind;
  /** A catalogue key, never a sentence: §24 forbids a user-facing string in code. */
  labelKey: string;
  values: Record<string, string | number>;
  /** `null` is "not measured" and renders as such. It is never written as 0 (§2.4). */
  value: number | null;
  unit: string | null;
  at: number;
  seriesRef?: string;
  href?: string;
};

/** What a problem is about. */
export type SubjectRef = {
  type: SubjectKind;
  id: string;
  name: string;
  /** The service this subject belongs to, when it belongs to one. */
  serviceId: string | null;
};

/**
 * What a detector returns when it fires. It carries the numbers `scoreProblem` needs rather than a score, so
 * the detector decides *what is true* and the scorer decides *how much it matters* — one place each.
 */
export type DetectedProblem = {
  /** The detector id, which becomes the problem's `kind` and the wire `category`. */
  kind: string;
  subject: SubjectRef;
  level: DetectorLevel;
  titleKey: string;
  values: Record<string, string | number>;
  href: string;
  /** Required, and required to be non-empty: see the note on `Evidence`. */
  evidence: readonly [Evidence, ...Evidence[]];
  blast: { affected: number; members: number } | null;
  minutesBreaching: number;
  userFacing: UserFacing;
  robustZ: number | null;
  totalFailure?: boolean;
  floorCritical?: boolean;
};

/**
 * §33.5's three outcomes, recorded per subject per detector every cycle.
 *
 * The distinction between `clear` and `not_evaluated` is the whole ruling: a subject that was looked at and
 * found healthy is evidence, and a subject that a capped cycle never reached is not. Collapsing them lets a
 * problem resolve itself because nobody checked, which is the failure §33.5 exists to prevent.
 */
export type SubjectOutcome =
  | { state: 'fired'; kind: string; subject: SubjectRef; problem: DetectedProblem }
  | { state: 'clear'; kind: string; subject: SubjectRef }
  | { state: 'not_evaluated'; kind: string; subject: SubjectRef };

/** The key parts an outcome maps to, so the lifecycle can line outcomes up against live rows. */
export function outcomeKeyParts(outcome: SubjectOutcome): { kind: string; subjectId: string } {
  return { kind: outcome.kind, subjectId: outcome.subject.id };
}
