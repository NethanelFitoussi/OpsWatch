/**
 * Signing in, and the sessions a signed-in actor owns.
 *
 * Nothing here ever carries a credential except the one place that must: `authSession.token`, the value the server
 * mints and hands to the caller once, at sign-in. It is never returned again — not by `/me`, not by `/me/sessions`.
 */
import { z } from 'zod';
import { epochSchema, idSchema, lenientEnum } from './primitives';
import { roleSchema } from './authorization';

/**
 * Which kind of client a credential was minted for. A bearer token is minted for `api` and a cookie for `web`, and
 * neither is accepted where the other belongs, so a stolen mobile token cannot be replayed as a browser session.
 */
export const TOKEN_AUDIENCES = ['web', 'api'] as const;
export type TokenAudience = (typeof TOKEN_AUDIENCES)[number];
export const tokenAudienceSchema = lenientEnum(TOKEN_AUDIENCES, 'api');

export const loginRequestSchema = z.object({ email: z.string().min(1).max(320), password: z.string().min(1).max(1024) });
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const userSchema = z.object({ email: z.string(), name: z.string().optional() });
export type User = z.infer<typeof userSchema>;

export const authSessionSchema = z.object({ token: z.string().min(16), expiresAt: epochSchema, user: userSchema });
export type AuthSession = z.infer<typeof authSessionSchema>;

/**
 * What `GET /me` answers. Every field beyond `userSchema` is optional, so the mobile client keeps parsing this with
 * `userSchema` and nothing it already reads can move or disappear.
 */
export const meSchema = userSchema.extend({
  id: idSchema.optional(),
  role: roleSchema.optional(),
  locale: z.string().optional(),
  allowedActions: z.array(z.string()).optional(),
});
export type Me = z.infer<typeof meSchema>;

/**
 * One row of `GET /me/sessions`. `id` is a value derived from the stored session for revocation only: it cannot be
 * presented as a credential and it is not the key the server looks a token up by.
 */
export const sessionSummarySchema = z.object({
  id: idSchema,
  audience: tokenAudienceSchema,
  createdAt: epochSchema,
  /** `null` until the session is used a second time. */
  lastUsedAt: epochSchema.nullable().default(null),
  /** When the rolling window runs out, and the ceiling no amount of use can push past. */
  expiresAt: epochSchema,
  absoluteExpiresAt: epochSchema,
  /** True for the session that made this very request, so a client can warn before it signs itself out. */
  current: z.boolean().default(false),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

export const sessionListSchema = z.object({
  items: z.array(sessionSummarySchema),
  nextCursor: z.string().nullable().default(null),
});
export type SessionList = z.infer<typeof sessionListSchema>;
