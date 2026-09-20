import 'server-only';

/**
 * The severity score of §4.3, written down so it can be argued with, and amended by §33.7.
 *
 * Pure: it takes every number it needs and reads no clock, no database and no AWS. `nowMs` and
 * `subjectFirstSeenAt` are parameters for exactly that reason — the whole engine is testable because nothing
 * in it asks the world what time it is.
 */

/** The five weights, in one place. Changing one is a one-line change plus a fixture update. */
export const SCORE_WEIGHTS = { s: 40, b: 20, t: 15, u: 15, d: 10 } as const;

/** `S`: what the detector itself thinks, before anything is known about the blast radius or the exposure. */
export const LEVEL_S = { critical: 1, warning: 0.55, info: 0.2 } as const;

/** `B` for a subject that has no family to be a fraction of — a standalone resource, a certificate. */
export const NO_FAMILY_B = 0.34;

/** Below this age a subject has not been around long enough for a missing edge to mean anything (§33.7). */
export const FRESH_SUBJECT_MS = 2 * 60 * 60_000;

export const CRITICAL_SCORE = 70;
export const WARNING_SCORE = 40;

/** Deviation is expressed in robust z units; six of them is as abnormal as the score bothers to distinguish. */
const MAX_Z = 6;
/** Persistence saturates after an hour: something breaching for three hours is not three times worse. */
const PERSISTENCE_MINUTES = 60;

export type DetectorLevel = keyof typeof LEVEL_S;
export type Severity = 'critical' | 'warning' | 'info';

/** How exposed the subject is. `null` means *unknown* — no dependency edge exists yet — not "not exposed". */
export type UserFacing = 'direct' | 'dependency' | 'none' | null;

export type ScoreInput = {
  level: DetectorLevel;
  /** Affected members over the members of the subject's family, or `null` when it has no family. */
  blast: { affected: number; members: number } | null;
  minutesBreaching: number;
  userFacing: UserFacing;
  /** From §8's baseline, or `null` when there is no baseline yet. */
  robustZ: number | null;
  subjectFirstSeenAt: number;
  nowMs: number;
  /** The subject has failed completely: zero running tasks, zero healthy targets, every request failing. */
  totalFailure?: boolean;
  /** The detector declares a floor: zero healthy targets, a synthetic down, a certificate under seven days. */
  floorCritical?: boolean;
};

export type ScoreTerms = {
  s: number;
  /** `null` when it was left out rather than zero-filled — see §33.7 below. */
  b: number | null;
  t: number;
  u: number | null;
  d: number;
  weights: typeof SCORE_WEIGHTS;
  /** The weight of the terms actually known. 100 unless a term was left out. */
  availableWeight: number;
  rescaled: boolean;
  floored: boolean;
  score: number;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const USER_FACING_U: Record<Exclude<UserFacing, null>, number> = { direct: 1, dependency: 0.5, none: 0 };

/**
 * Scores one problem, and records the arithmetic it used so the page can render it under "Why this score".
 *
 * **§33.7, first half.** A subject with no dependency edge that was first seen less than two hours ago has its
 * `U` and `B` *left out* rather than zero-filled, and the score is rescaled over the weight actually available.
 * The finding this fixes: a user-facing service that fails minutes after its first deploy used to score 51 and
 * read as a warning, because it was punished for facts that did not exist yet. Absence of evidence is not
 * evidence of absence.
 *
 * **§33.7, second half.** A total failure, or a detector that declares a floor, produces at least
 * `CRITICAL_SCORE` whatever the formula says — because the formula's inputs are exactly what is missing when a
 * service has just died.
 *
 * `D` is never dropped: §4.3 says a missing baseline scores 0, and it says so because no baseline is the
 * ordinary case on a fresh install rather than a gap peculiar to new subjects.
 */
export function scoreProblem(input: ScoreInput): ScoreTerms {
  const edgeUnknown = input.userFacing === null;
  const fresh = input.nowMs - input.subjectFirstSeenAt < FRESH_SUBJECT_MS;
  const excused = edgeUnknown && fresh;

  const s = LEVEL_S[input.level];
  const t = clamp01(input.minutesBreaching / PERSISTENCE_MINUTES);
  const d = input.robustZ === null ? 0 : clamp01(Math.abs(input.robustZ) / MAX_Z);
  const b = excused ? null : input.blast === null ? NO_FAMILY_B : clamp01(safeRatio(input.blast));
  const u = excused ? null : USER_FACING_U[input.userFacing ?? 'none'];

  const terms: [number, number | null][] = [
    [SCORE_WEIGHTS.s, s],
    [SCORE_WEIGHTS.b, b],
    [SCORE_WEIGHTS.t, t],
    [SCORE_WEIGHTS.u, u],
    [SCORE_WEIGHTS.d, d],
  ];
  const availableWeight = terms.reduce((total, [weight, value]) => (value === null ? total : total + weight), 0);
  const weighted = terms.reduce((total, [weight, value]) => (value === null ? total : total + weight * value), 0);
  const raw = availableWeight === 0 ? 0 : Math.round((weighted / availableWeight) * 100);

  const floor = input.totalFailure === true || input.floorCritical === true ? CRITICAL_SCORE : 0;
  const score = Math.min(100, Math.max(0, raw, floor));

  return {
    s,
    b,
    t,
    u,
    d,
    weights: SCORE_WEIGHTS,
    availableWeight,
    rescaled: availableWeight !== 100,
    floored: score > raw,
    score,
  };
}

/** A family of zero members would divide by zero; it means the same thing as no family at all. */
function safeRatio(blast: { affected: number; members: number }): number {
  return blast.members <= 0 ? NO_FAMILY_B : blast.affected / blast.members;
}

/** §4.3: the label is derived from the score, never set independently of it. */
export function severityForScore(score: number): Severity {
  if (score >= CRITICAL_SCORE) return 'critical';
  return score >= WARNING_SCORE ? 'warning' : 'info';
}
