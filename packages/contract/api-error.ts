/**
 * The one error envelope of the API. Every failure of every endpoint answers this shape, so a client writes the
 * handling once.
 */
import { z } from 'zod';

/**
 * `action` and `code` carry the AWS permission and error behind a failure, for example `logs:StartQuery`.
 *
 * `error` stays a plain string rather than an enum: a newer server may name a code this client does not know, and a
 * client that cannot parse the failure is worse off than one that shows an unknown code.
 */
export const apiErrorBodySchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  action: z.string().optional(),
  code: z.string().optional(),
});
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;

/** Every code v1 answers with, and the status each one carries. Snake case, as the rest of the API. */
export const API_ERROR_STATUS = {
  invalid_request: 400,
  invalid_cursor: 400,
  invalid_credentials: 401,
  unauthorized: 401,
  forbidden: 403,
  forbidden_origin: 403,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  rate_limited: 429,
  internal_error: 500,
  aws_denied: 403,
  aws_throttled: 429,
  aws_error: 502,
  unavailable: 503,
} as const satisfies Record<string, number>;

export type ApiErrorCode = keyof typeof API_ERROR_STATUS;
export const API_ERROR_CODES = Object.keys(API_ERROR_STATUS) as ApiErrorCode[];
