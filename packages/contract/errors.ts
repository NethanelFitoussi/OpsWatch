/**
 * Error groups and the logs behind them.
 *
 * An error group is a fingerprint, not a single occurrence: it is what a screen lists, counts and follows over time.
 */
import { z } from 'zod';
import { allowedActionsSchema, epochSchema, idSchema, lenientEnum, nullableNumberSchema, refSchema, seriesSchema } from './primitives';

export const ERROR_STATUSES = ['new', 'recurring', 'regression', 'resolved'] as const;
export type ErrorStatus = (typeof ERROR_STATUSES)[number];

export const errorSummarySchema = z.object({
  id: idSchema,
  message: z.string(),
  type: z.string().optional(),
  status: lenientEnum(ERROR_STATUSES, 'recurring'),
  service: refSchema.optional(),
  route: z.string().optional(),
  occurrences: nullableNumberSchema.default(null),
  affectedInstances: nullableNumberSchema.default(null),
  firstSeenAt: epochSchema,
  lastSeenAt: epochSchema,
  problemId: idSchema.optional(),
});
export type ErrorSummary = z.infer<typeof errorSummarySchema>;

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal', 'unknown'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const logEntrySchema = z.object({
  id: idSchema,
  timestamp: epochSchema,
  level: lenientEnum(LOG_LEVELS, 'unknown'),
  service: z.string().optional(),
  source: z.string().optional(),
  message: z.string(),
  fields: z.record(z.string(), z.string()).optional(),
  links: z.object({ errorId: idSchema.optional(), problemId: idSchema.optional(), serviceId: idSchema.optional() }).optional(),
});
export type LogEntry = z.infer<typeof logEntrySchema>;

export const stackFrameSchema = z.object({
  function: z.string().optional(),
  file: z.string().optional(),
  line: z.number().int().optional(),
  column: z.number().int().optional(),
  module: z.string().optional(),
  /** Application code rather than a dependency or the runtime. The viewer emphasises these frames. */
  inApp: z.boolean().default(false),
  context: z.array(z.object({ line: z.number().int(), code: z.string() })).optional(),
});
export type StackFrame = z.infer<typeof stackFrameSchema>;

export const errorDetailSchema = errorSummarySchema.extend({
  frames: z.array(stackFrameSchema).default([]),
  rawStack: z.string().optional(),
  instances: z.array(z.string()).default([]),
  sampleLogs: z.array(logEntrySchema).default([]),
  trend: seriesSchema.optional(),
  allowedActions: allowedActionsSchema,
});
export type ErrorDetail = z.infer<typeof errorDetailSchema>;

export const logSearchSchema = z.object({
  searchId: z.string(),
  status: lenientEnum(['running', 'complete', 'partial', 'failed'] as const, 'failed'),
  items: z.array(logEntrySchema),
  nextCursor: z.string().nullable().default(null),
  statistics: z.object({ recordsMatched: z.number(), recordsScanned: z.number() }).optional(),
});
export type LogSearch = z.infer<typeof logSearchSchema>;
