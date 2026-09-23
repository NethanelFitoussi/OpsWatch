/**
 * What Cloudflare saw at the edge (CF-2).
 *
 * Every field is a count Cloudflare reported or a ratio of two of them, so a client can recompute any rate
 * from the counts and check it. A rate is **nullable on purpose**: a zone with no traffic has no cache hit
 * rate, and a client rendering `0%` would be inventing a measurement nobody took.
 */
import { z } from 'zod';
import { idSchema, nullableNumberSchema } from './primitives';

export const CLOUDFLARE_STATES = ['not_connected', 'unverified', 'no_zones', 'no_data', 'ready'] as const;

export const cloudflareDaySchema = z.object({
  /** `YYYY-MM-DD` in UTC, as Cloudflare groups a day. */
  date: z.string(),
  requests: z.number().int(),
  cachedRequests: z.number().int(),
  bytes: z.number().int(),
  cachedBytes: z.number().int(),
  threats: z.number().int(),
  clientErrors: z.number().int(),
  serverErrors: z.number().int(),
  /** Null where the zone's plan does not report it — which is not the same as nobody having visited. */
  uniques: nullableNumberSchema.default(null),
});
export type CloudflareDay = z.infer<typeof cloudflareDaySchema>;

export const cloudflareZoneSchema = z.object({
  id: idSchema,
  name: z.string(),
  requests: z.number().int(),
  bytes: z.number().int(),
  threats: z.number().int(),
  cacheHitRate: nullableNumberSchema.default(null),
  cachedByteShare: nullableNumberSchema.default(null),
  clientErrorRate: nullableNumberSchema.default(null),
  serverErrorRate: nullableNumberSchema.default(null),
  /** Change in requests against the day before, as a ratio. Null on the first day of data. */
  requestsTrend: nullableNumberSchema.default(null),
  days: z.array(cloudflareDaySchema).default([]),
});
export type CloudflareZone = z.infer<typeof cloudflareZoneSchema>;

export const cloudflareOverviewSchema = z.object({
  /**
   * Which of the four emptinesses, or `ready`.
   *
   * They are kept apart because each needs something different from the operator: connect, verify, choose
   * a zone, or simply wait for the next collector pass.
   */
  state: z.enum(CLOUDFLARE_STATES),
  zones: z.array(cloudflareZoneSchema).default([]),
  totals: z.object({
    requests: z.number().int(),
    bytes: z.number().int(),
    threats: z.number().int(),
    cacheHitRate: nullableNumberSchema.default(null),
    serverErrorRate: nullableNumberSchema.default(null),
  }),
});
export type CloudflareOverviewPayload = z.infer<typeof cloudflareOverviewSchema>;
