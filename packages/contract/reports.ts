/**
 * Reports: what a period looked like, next to the period before it (**§19**).
 *
 * Two decisions shape this shape.
 *
 * **Every figure carries its comparison.** "14 problems opened" means nothing on its own; "14, against 31
 * the week before" is the sentence an operator can act on. So a figure is never a bare number — it is a
 * value, the previous period's value, and the difference, and any of them may be `null`.
 *
 * **A section that cannot be answered says why.** A report reads stored rollups and never AWS, so on an
 * installation with historical collection off there is genuinely nothing to say about availability. An empty
 * section and an unmeasured one are different answers (§2.6), and `unavailable` is how they are told apart:
 * it is a named reason, never an empty list left for a client to interpret.
 */
import { z } from 'zod';
import { epochSchema, idSchema, lenientEnum, nullableNumberSchema, refSchema, severitySchema } from './primitives';

/** The periods §19 names. A report is always over one of them, and always states which. */
export const REPORT_PERIODS = ['24h', '7d', '30d'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

/**
 * Why a section has no figures. Each is a different sentence to the reader, which is the reason they are
 * separate values rather than one "unavailable" flag:
 *
 * - `history_off` — nothing is wrong; historical collection has not been switched on, and switching it on
 *   costs AWS requests. The reader is being asked to make a decision, not told about a fault.
 * - `not_enough_history` — it is on, but the window asked for is not yet covered. §19: a report never shows
 *   a number it cannot stand behind.
 * - `not_collected` — the source exists but nothing is configured to read it, such as errors with no log
 *   sources selected.
 * - `not_measured` — nothing in this build measures it at all.
 */
export const REPORT_UNAVAILABLE_REASONS = ['history_off', 'not_enough_history', 'not_collected', 'not_measured'] as const;
export type ReportUnavailableReason = (typeof REPORT_UNAVAILABLE_REASONS)[number];
export const reportUnavailableReasonSchema = lenientEnum(REPORT_UNAVAILABLE_REASONS, 'not_measured');

/** One number and what it is being compared with. `delta` is `value - previous`, or null if either is null. */
export const reportFigureSchema = z.object({
  id: idSchema,
  value: nullableNumberSchema.default(null),
  previous: nullableNumberSchema.default(null),
  delta: nullableNumberSchema.default(null),
  /** Present only where a severity is what the figure counts, so a client can colour it without parsing `id`. */
  severity: severitySchema.optional(),
});
export type ReportFigure = z.infer<typeof reportFigureSchema>;

/** A named row inside a section — a service, an error group, a resource — with the same comparison. */
export const reportRowSchema = z.object({
  id: idSchema,
  label: z.string(),
  value: nullableNumberSchema.default(null),
  previous: nullableNumberSchema.default(null),
  delta: nullableNumberSchema.default(null),
  severity: severitySchema.optional(),
  /** Where the row points, so a report is a way into the product rather than a dead end. */
  ref: refSchema.optional(),
});
export type ReportRow = z.infer<typeof reportRowSchema>;

export const reportSectionSchema = z.object({
  id: idSchema,
  figures: z.array(reportFigureSchema).default([]),
  rows: z.array(reportRowSchema).default([]),
  /**
   * Null when the section was answered. When it is set, `figures` and `rows` are empty and the reason is
   * what the page renders — never "0", which would be a claim nobody measured.
   */
  unavailable: reportUnavailableReasonSchema.nullable().default(null),
});
export type ReportSection = z.infer<typeof reportSectionSchema>;

export const reportSchema = z.object({
  generatedAt: epochSchema,
  /** Which monitoring section this report covers: `containers`, `databases`, `load-balancers`, `alarms`. */
  section: z.string(),
  period: z.object({ id: lenientEnum(REPORT_PERIODS, '7d'), from: epochSchema, to: epochSchema }),
  /** The same length immediately before `period`, which is what every figure is compared against. */
  previousPeriod: z.object({ from: epochSchema, to: epochSchema }),
  sections: z.array(reportSectionSchema).default([]),
});
export type Report = z.infer<typeof reportSchema>;
