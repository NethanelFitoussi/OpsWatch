/**
 * Error groups and the logs behind them.
 *
 * An error group is a fingerprint, not a single occurrence: it is what a screen lists, counts and follows over time.
 */
import { z } from 'zod';
import {
  allowedActionsSchema,
  epochSchema,
  idSchema,
  lenientEnum,
  nullableNumberSchema,
  refSchema,
  seriesSchema,
  trendSchema,
} from './primitives';
import { deploymentSummarySchema } from './deployments';
import { repositoryEvidenceSchema } from './repository';

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
  /**
   * The window `occurrences` and `affectedInstances` are counted over. **`null` means lifetime**, since
   * `firstSeenAt`. A count without its window is not a count, so a windowed figure is never sent with the
   * window omitted.
   */
  occurrencesWindow: z.object({ from: epochSchema, to: epochSchema }).nullable().default(null),
  firstSeenAt: epochSchema,
  lastSeenAt: epochSchema,
  /**
   * When the group entered its current `status`. For a `regression` this is when it came back, which is the
   * whole point of that state — `firstSeenAt` is the group's first ever sighting and answers a different
   * question.
   */
  statusSince: epochSchema.optional(),
  /** Whether it is getting worse, read from the hourly rollups. `null` renders as "no trend", never `stable`. */
  trend: trendSchema,
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
  links: z
    .object({
      errorId: idSchema.optional(),
      problemId: idSchema.optional(),
      serviceId: idSchema.optional(),
      deploymentId: idSchema.optional(),
      incidentId: idSchema.optional(),
    })
    .optional(),
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
  /**
   * Deployments shortly before the group started or regressed, and the code the stack trace points at. The
   * same shapes `problemDetail` carries, because a stack trace lives on the error group and an error with no
   * problem would otherwise have no route to either. Correlation, never a claim of causation.
   */
  deployments: z.array(z.object({ deployment: deploymentSummarySchema, minutesBeforeError: z.number() })).default([]),
  repository: z.array(repositoryEvidenceSchema).default([]),
  allowedActions: allowedActionsSchema,
});
export type ErrorDetail = z.infer<typeof errorDetailSchema>;

export const logSearchSchema = z.object({
  searchId: z.string(),
  /**
   * `partial` is the one that matters: the search finished, and more lines matched than were returned. A
   * client that reads it as `complete` prints a sample as a total.
   */
  status: lenientEnum(['running', 'complete', 'partial', 'failed'] as const, 'failed'),
  /** Empty while `running`, which is a different answer from having finished and matched nothing. */
  items: z.array(logEntrySchema),
  nextCursor: z.string().nullable().default(null),
  statistics: z.object({ recordsMatched: z.number(), recordsScanned: z.number() }).optional(),
  /**
   * The query the server composed and sent to AWS. Optional because it was added after the shape was
   * first published; present on everything `/api/v1/logs` answers, so a caller can see the search that
   * ran rather than infer it from what it asked for.
   */
  query: z.string().optional(),
});
export type LogSearch = z.infer<typeof logSearchSchema>;
