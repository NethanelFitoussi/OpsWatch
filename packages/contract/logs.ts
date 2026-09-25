/**
 * Searching logs over the API (LOG-5).
 *
 * The answer's shape was already fixed: `logSearchSchema` and `logEntrySchema` live beside the error
 * groups, because an error group's sample lines and a log search's results are the same thing seen twice.
 * What was missing was the way in — what a caller sends, and what log groups there are to send it about.
 *
 * A Logs Insights search is not a read, it is a **job**: AWS starts it, works on it, and answers when it
 * is done. The API says so rather than pretending, so a client can show progress instead of holding a
 * request open for half a minute, and `status` is what it reads before it reads the lines. A search that
 * has not finished has no lines *yet*, which is a different answer from one that finished and matched
 * nothing.
 *
 * What this deliberately does **not** do is keep the results. AWS holds them for its own fifteen minutes
 * and OpsWatch holds only a binding saying which caller may poll which search. Storing somebody's log
 * lines to make a tidier API would be storing the most sensitive thing in the account for convenience.
 */
import { z } from 'zod';
import { LOG_LEVELS } from './errors';
import { lenientEnum } from './primitives';

/** One log group this environment holds. */
export const logSourceSchema = z.object({
  name: z.string(),
  /**
   * What AWS says this group is storing, or `null` when it did not say — a name search answers without
   * sizes, and `0` would be a claim that the group is empty (§2.4).
   */
  storedBytes: z.number().nullable(),
  /** `null` where the group keeps its events for ever, which is not a retention of zero days. */
  retentionDays: z.number().nullable(),
});
export type LogSource = z.infer<typeof logSourceSchema>;

export const logSourceListSchema = z.object({
  items: z.array(logSourceSchema),
  /**
   * True when the region holds more groups than were listed. The caller narrows with `?q=`; a list that
   * quietly stopped at a limit would read as the whole estate.
   */
  truncated: z.boolean(),
});
export type LogSourceList = z.infer<typeof logSourceListSchema>;

/**
 * What a caller asks for. Deliberately **not** a Logs Insights query string: the server composes the
 * query, so a caller cannot ask for a `stats` aggregation the result shape cannot carry, and cannot widen
 * the search past the log groups it named.
 */
export const logSearchRequestSchema = z.object({
  /** The log groups to search. Bounded by the server, which refuses a longer list rather than trimming it. */
  logGroups: z.array(z.string().min(1).max(512)).min(1),
  /** Plain text, matched case-insensitively anywhere in the message. */
  text: z.string().max(200).optional(),
  /** The level the line announces about itself. `null` means any. */
  level: lenientEnum(LOG_LEVELS, 'error').nullish(),
  /** How many lines to bring back; the server bounds this too. */
  limit: z.number().int().positive().optional(),
  /** How far back to look, in seconds, ending now. Bounded by the server's maximum range. */
  rangeSeconds: z.number().int().positive(),
});
export type LogSearchRequest = z.infer<typeof logSearchRequestSchema>;
