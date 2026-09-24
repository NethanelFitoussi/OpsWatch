/**
 * The weekly summary: when one is due, and what one says (REP-7).
 *
 * Pure. No clock of its own, no database, no network — so "is it Monday at eight yet" can be tested
 * against fixed instants rather than against the machine that runs the tests.
 *
 * **What the payload carries is counts and a link, and nothing else.** A report's error section lists the
 * sample message of each group, and a sample message is a raw log line: whatever some process wrote,
 * including whatever an attacker made it write. `lib/notify/payload.ts` promises no raw log line ever
 * leaves the instance, and the way this keeps that promise is by sending numbers.
 */

/** A week, as the interval between two sends. The job runs far more often and sends on this cadence. */
export const WEEK_MS = 7 * 24 * 60 * 60_000;

export type DigestSchedule = {
  enabled: boolean;
  /** 0 is Sunday, matching `Date#getUTCDay`. */
  dayOfWeek: number;
  hourUtc: number;
  lastSentAt: number | null;
};

/**
 * Whether a summary should go out now.
 *
 * Three conditions, in the order they are cheapest to check:
 *
 *   1. somebody switched it on — off is the default and stays it;
 *   2. it is the chosen day and the chosen hour, in UTC;
 *   3. a week has passed since the last one.
 *
 * The third is what makes the send weekly rather than hourly. Without it the job would send a summary on
 * every cycle inside the chosen hour, which for an hourly job is one duplicate and for a five-minute job
 * would be twelve.
 *
 * A first run has never sent one, so the third condition is satisfied and the first eligible hour sends.
 */
export function digestIsDue(schedule: DigestSchedule, nowMs: number): boolean {
  if (!schedule.enabled) return false;
  const now = new Date(nowMs);
  if (now.getUTCDay() !== schedule.dayOfWeek || now.getUTCHours() !== schedule.hourUtc) return false;
  return schedule.lastSentAt === null || nowMs - schedule.lastSentAt >= WEEK_MS;
}

export type DigestCounts = {
  /** Null where the report could not answer that half, never zero standing in for unmeasured. */
  problemsOpened: number | null;
  problemsResolved: number | null;
  errorOccurrences: number | null;
};

/**
 * The counts a summary reports, taken out of a report OpsWatch already produced.
 *
 * Read from the report rather than recomputed, so what is sent and what the Report page shows cannot
 * disagree. A section the report declared unavailable contributes `null`, which a receiver renders as
 * "not measured" — exactly as the page does, and never as a zero.
 */
export function digestCounts(report: {
  sections: readonly { id: string; figures: readonly { id: string; value: number | null }[]; unavailable: string | null }[];
}): DigestCounts {
  const figureOf = (sectionId: string, figureId: string): number | null => {
    const section = report.sections.find((one) => one.id === sectionId);
    if (section === undefined || section.unavailable !== null) return null;
    return section.figures.find((one) => one.id === figureId)?.value ?? null;
  };
  return {
    problemsOpened: figureOf('problems', 'opened'),
    problemsResolved: figureOf('problems', 'resolved'),
    errorOccurrences: figureOf('errors', 'occurrences'),
  };
}
