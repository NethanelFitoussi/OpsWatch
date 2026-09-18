/**
 * The only place in the app that performs network requests (enforced by ESLint's `no-restricted-globals`).
 *
 * - Bearer token, `Accept-Language`, JSON bodies.
 * - A timeout on every request through AbortController.
 * - Bounded retries with jittered backoff, only for idempotent requests and transient failures.
 * - Response validation against the contract schema.
 * - Nothing about the request or response is ever logged: headers carry the session token.
 */
import type { z } from 'zod';
import { apiErrorBodySchema } from './contract';
import { ApiError, isTransient, kindForStatus } from './errors';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export type RequestOptions<T extends z.ZodType> = {
  method?: HttpMethod;
  /** Path below the server origin, starting with `/`. */
  path: string;
  query?: Record<string, string | number | boolean | null | undefined | readonly string[]>;
  body?: unknown;
  schema: T;
  token?: string | null;
  timeoutMs?: number;
  /** Retries for idempotent requests. POST is never retried unless `idempotent` is set. */
  retries?: number;
  idempotent?: boolean;
  signal?: AbortSignal;
};

export type Transport = {
  baseUrl: string;
  locale?: string;
  fetchImpl?: typeof fetch;
  /** Injected in tests to avoid real waiting. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

export const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;
const BACKOFF_BASE_MS = 400;
const MAX_ERROR_MESSAGE = 300;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function buildUrl(baseUrl: string, path: string, query?: RequestOptions<z.ZodType>['query']): string {
  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  // `new URL('/x', base)` drops a sub-path of the base (OpsWatch behind `/ops`), so rebuild from the base path.
  const basePath = new URL(baseUrl).pathname.replace(/\/+$/, '');
  url.pathname = `${basePath}${path.startsWith('/') ? path : `/${path}`}`;
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function readErrorBody(response: Response): Promise<{ code?: string; message?: string; action?: string }> {
  try {
    const parsed = apiErrorBodySchema.safeParse(await response.json());
    if (!parsed.success) return {};
    return { code: parsed.data.error, message: parsed.data.message?.slice(0, MAX_ERROR_MESSAGE), action: parsed.data.action?.slice(0, 120) };
  } catch {
    return {};
  }
}

async function attempt<T extends z.ZodType>(transport: Transport, options: RequestOptions<T>): Promise<z.output<T>> {
  const fetchImpl = transport.fetchImpl ?? fetch;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (transport.locale) headers['Accept-Language'] = transport.locale;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetchImpl(buildUrl(transport.baseUrl, options.path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      // Cookies are not part of the mobile contract; the bearer token is the only credential.
      credentials: 'omit',
    });
  } catch {
    if (options.signal?.aborted) throw new ApiError('cancelled');
    throw new ApiError(timedOut ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }

  if (!response.ok) {
    const { code, message, action } = await readErrorBody(response);
    throw new ApiError(kindForStatus(response.status), { status: response.status, code, message, action });
  }

  if (response.status === 204) {
    return parseOrThrow(options.schema, undefined, response.status);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    // A reverse proxy's HTML page, a captive portal, or a truncated body.
    throw new ApiError('invalid_response', { status: response.status });
  }
  return parseOrThrow(options.schema, json, response.status);
}

function parseOrThrow<T extends z.ZodType>(schema: T, value: unknown, status: number): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    // The issue path helps diagnose contract drift; it never contains response values.
    const where = parsed.error.issues[0]?.path.join('.') || 'root';
    throw new ApiError('invalid_response', { status, message: `Response does not match the contract at ${where}` });
  }
  return parsed.data;
}

export async function request<T extends z.ZodType>(transport: Transport, options: RequestOptions<T>): Promise<z.output<T>> {
  const method = options.method ?? 'GET';
  const idempotent = options.idempotent ?? (method === 'GET' || method === 'PUT' || method === 'DELETE');
  const retries = idempotent ? (options.retries ?? DEFAULT_RETRIES) : 0;
  const sleep = transport.sleep ?? defaultSleep;
  const random = transport.random ?? Math.random;

  for (let attemptNumber = 0; ; attemptNumber += 1) {
    try {
      return await attempt(transport, options);
    } catch (error) {
      if (!(error instanceof ApiError) || !isTransient(error) || attemptNumber >= retries || options.signal?.aborted) {
        throw error;
      }
      const delay = BACKOFF_BASE_MS * 2 ** attemptNumber * (0.5 + random());
      await sleep(delay);
    }
  }
}
