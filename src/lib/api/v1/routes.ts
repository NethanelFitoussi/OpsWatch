import 'server-only';
import { z } from 'zod';
import {
  type ApiErrorCode,
  authSessionSchema,
  environmentListSchema,
  loginRequestSchema,
  briefSchema,
  checkupSchema,
  errorDetailSchema,
  errorSummarySchema,
  healthSchema,
  meSchema,
  pageSchema,
  problemDetailSchema,
  problemSummarySchema,
  reportSchema,
  serverInfoSchema,
  sessionListSchema,
  systemStatusSchema,
} from '@opswatch/contract';

/**
 * Every route `/api/v1` implements, in one list.
 *
 * It is the single description of the surface: the OpenAPI document is generated from it, and
 * `tests/unit/api-openapi.test.ts` checks it against the route files on disk, so a route cannot exist without being
 * documented and an entry cannot survive its route being deleted.
 */
export type ApiRouteSpec = {
  method: 'get' | 'post' | 'delete';
  /** The path under `/api/v1`, written the way OpenAPI writes it: `/me/sessions/{id}`. */
  path: string;
  /**
   * What each `{name}` in `path` means. The parameters themselves are derived from the template, so one can never
   * be forgotten; this only carries the prose, and a name that is not in the path is a mistake the test catches.
   */
  pathParams?: Record<string, string>;
  operationId: string;
  /** `none` is unauthenticated; `session` needs the browser cookie or a bearer token. */
  auth: 'none' | 'session';
  summary: string;
  request?: z.ZodType;
  response?: z.ZodType;
  /** 204 for the routes that answer nothing. */
  status: number;
  /** The failures this route can answer, beyond the ones every route shares. */
  errors: ApiErrorCode[];
};

/** Anything can fail this way, so it is not repeated on every entry. */
export const COMMON_ERRORS: ApiErrorCode[] = ['internal_error'];

const openApiDocumentSchema = z.looseObject({ openapi: z.string(), info: z.object({ title: z.string(), version: z.string() }) });

export const API_ROUTES: ApiRouteSpec[] = [
  {
    method: 'get',
    path: '/server',
    operationId: 'getServerInfo',
    auth: 'none',
    summary: 'Product, version, API version, sign-in methods and feature flags. The only unauthenticated endpoint.',
    response: serverInfoSchema,
    status: 200,
    errors: [],
  },
  {
    method: 'get',
    path: '/openapi.json',
    operationId: 'getOpenApiDocument',
    auth: 'none',
    summary: 'This document, generated from the shared contract schemas.',
    response: openApiDocumentSchema,
    status: 200,
    errors: [],
  },
  {
    method: 'post',
    path: '/auth/login',
    operationId: 'login',
    auth: 'none',
    summary: 'Signs in with a password and mints a bearer token for a non-browser client.',
    request: loginRequestSchema,
    response: authSessionSchema,
    status: 200,
    errors: ['invalid_request', 'invalid_credentials', 'rate_limited', 'forbidden_origin'],
  },
  {
    method: 'post',
    path: '/auth/logout',
    operationId: 'logout',
    auth: 'session',
    summary: 'Revokes the credential the caller presented.',
    status: 204,
    errors: ['unauthorized', 'forbidden_origin'],
  },
  {
    method: 'get',
    path: '/me',
    operationId: 'getMe',
    auth: 'session',
    summary: 'The signed-in user, their role and what they are allowed to do.',
    response: meSchema,
    status: 200,
    errors: ['unauthorized'],
  },
  {
    method: 'get',
    path: '/me/sessions',
    operationId: 'listSessions',
    auth: 'session',
    summary: 'Every session of the caller, so a lost device can be found and cut off.',
    response: sessionListSchema,
    status: 200,
    errors: ['unauthorized'],
  },
  {
    method: 'delete',
    path: '/me/sessions/{id}',
    pathParams: { id: 'The public id of the session to revoke, as `GET /me/sessions` reports it.' },
    operationId: 'revokeSession',
    auth: 'session',
    summary: 'Revokes one session of the caller without rotating the instance secret.',
    status: 204,
    errors: ['unauthorized', 'forbidden_origin', 'not_found'],
  },
  {
    method: 'get',
    path: '/brief',
    operationId: 'getBrief',
    auth: 'session',
    summary: 'What changed in one environment since yesterday, and what to start on.',
    response: briefSchema,
    status: 200,
    errors: ['unauthorized', 'invalid_request', 'not_found'],
  },
  {
    method: 'get',
    path: '/health',
    operationId: 'getHealth',
    auth: 'session',
    summary: 'Whether one environment is healthy, and what could not be read.',
    response: healthSchema,
    status: 200,
    errors: ['unauthorized', 'invalid_request', 'not_found'],
  },
  {
    method: 'get',
    path: '/checkup',
    operationId: 'getCheckup',
    auth: 'session',
    summary: 'What is wrong with how one environment is set up, and how much of the catalogue could run.',
    response: checkupSchema,
    status: 200,
    errors: ['unauthorized', 'invalid_request', 'not_found'],
  },
  {
    method: 'get',
    path: '/reports',
    operationId: 'getReport',
    auth: 'session',
    summary: 'One period of one section, next to the period before it, from stored rollups only.',
    response: reportSchema,
    status: 200,
    errors: ['unauthorized', 'invalid_request', 'not_found'],
  },
  {
    method: 'get',
    path: '/errors',
    operationId: 'listErrors',
    auth: 'session',
    summary: 'Error groups in one environment, oldest first on an immutable cursor.',
    response: pageSchema(errorSummarySchema),
    status: 200,
    errors: ['unauthorized', 'invalid_request', 'invalid_cursor', 'not_found'],
  },
  {
    method: 'get',
    path: '/errors/{id}',
    pathParams: { id: 'The error group id, as a list entry reports it.' },
    operationId: 'getError',
    auth: 'session',
    summary: 'One error group and the frames its fingerprint was computed over.',
    response: errorDetailSchema,
    status: 200,
    errors: ['unauthorized', 'invalid_request', 'not_found'],
  },
  {
    method: 'get',
    path: '/problems',
    operationId: 'listProblems',
    auth: 'session',
    summary: 'Problems in one environment, oldest first on an immutable cursor.',
    response: pageSchema(problemSummarySchema),
    status: 200,
    errors: ['unauthorized', 'invalid_request', 'invalid_cursor', 'not_found'],
  },
  {
    method: 'get',
    path: '/problems/{id}',
    pathParams: { id: 'The problem id, as a list entry reports it.' },
    operationId: 'getProblem',
    auth: 'session',
    summary: 'One problem and the evidence that argued for it.',
    response: problemDetailSchema,
    status: 200,
    errors: ['unauthorized', 'invalid_request', 'not_found'],
  },
  {
    method: 'get',
    path: '/system/status',
    operationId: 'getSystemStatus',
    auth: 'session',
    summary: 'What OpsWatch knows about itself: the collector, its jobs and the database. Admin only.',
    response: systemStatusSchema,
    status: 200,
    errors: ['unauthorized', 'forbidden'],
  },
  {
    method: 'get',
    path: '/environments',
    operationId: 'listEnvironments',
    auth: 'session',
    summary: 'The connection and region pairs every data call is scoped to with ?env=.',
    response: environmentListSchema,
    status: 200,
    errors: ['unauthorized'],
  },
];
