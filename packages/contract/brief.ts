/**
 * The morning brief: what changed since the operator last looked, in one screen.
 *
 * It is health over a period rather than health at an instant, which is why it carries `period` and `changes`
 * instead of live counts alone.
 */
import { z } from 'zod';
import { epochSchema, healthStatusSchema } from './primitives';
import { changeSchema, healthCountsSchema } from './health';
import { problemSummarySchema } from './problems';

export const briefSchema = z.object({
  generatedAt: epochSchema,
  period: z.object({ from: epochSchema, to: epochSchema }),
  status: healthStatusSchema,
  counts: healthCountsSchema,
  changes: z.array(changeSchema),
  mostImportant: problemSummarySchema.nullable(),
});
export type Brief = z.infer<typeof briefSchema>;
