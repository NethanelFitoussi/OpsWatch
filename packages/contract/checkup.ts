/**
 * Checkup: what is wrong with how an environment is **set up** (Stage 3 §4).
 *
 * A finding is a standing observation about configuration — a permission never granted, a log group nobody
 * reads, a collector that has never run — and it stays until somebody changes a setting. That is a different
 * object from a problem, which is a thing breaking now that resolves itself when the trouble stops, and the
 * two are deliberately not merged.
 *
 * The shape carries §2.6 into the wire. A findings list of three, from a catalogue where two checks could
 * not run, is a lie about coverage — so `coverage` is not optional, and the checks that could not run travel
 * with the findings rather than being dropped on the way out. A client rendering only `findings` would be
 * rendering a claim; one rendering `coverage` alongside them is rendering a measurement.
 */
import { z } from 'zod';
import { epochSchema, idSchema, lenientEnum, refSchema, severitySchema } from './primitives';

/**
 * Why a check could not run. Each is a different sentence to a reader:
 *
 * - `denied` — the permission it needs was refused, so the answer is unknowable from here.
 * - `not_collected` — the server does not gather the data this check reads.
 * - `cap` — the scope was truncated to stay inside a query budget.
 * - `unsupported` — the resource cannot answer it at all.
 */
export const CHECK_NOT_RUN_REASONS = ['denied', 'not_collected', 'cap', 'unsupported'] as const;
export type CheckNotRunReason = (typeof CHECK_NOT_RUN_REASONS)[number];
export const checkNotRunReasonSchema = lenientEnum(CHECK_NOT_RUN_REASONS, 'not_collected');

/** Placeholders a client fills into its own localised sentence — never a sentence built by the server. */
export const checkValuesSchema = z.record(z.string(), z.union([z.string(), z.number()])).default({});

export const checkFindingSchema = z.object({
  /** The check's id, which is also the message key a client renders. */
  id: idSchema,
  severity: severitySchema,
  /** What the finding is about, when it is about one thing rather than the environment. */
  subject: z.string().nullable().default(null),
  values: checkValuesSchema,
  ref: refSchema.optional(),
});
export type CheckFinding = z.infer<typeof checkFindingSchema>;

export const checkNotRunSchema = z.object({
  id: idSchema,
  reason: checkNotRunReasonSchema,
  values: checkValuesSchema,
});
export type CheckNotRun = z.infer<typeof checkNotRunSchema>;

export const checkupSchema = z.object({
  generatedAt: epochSchema,
  /** Worst first. A client may re-sort, but this is the order the server stands behind. */
  findings: z.array(checkFindingSchema).default([]),
  /** Never optional: "no findings" means nothing without knowing how much of the catalogue answered. */
  coverage: z.object({ ran: z.number(), notRun: z.number(), total: z.number() }),
  /** The checks that could not run, carried rather than dropped (§2.6). */
  notRun: z.array(checkNotRunSchema).default([]),
});
export type Checkup = z.infer<typeof checkupSchema>;
