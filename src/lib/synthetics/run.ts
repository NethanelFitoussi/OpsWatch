import 'server-only';
import { MAX_BODY_BYTES, evaluateAssertion, runPassed, type Assertion, type AssertionResult } from '../detect/synthetic';
import { SsrfError, safeFetch } from '../net/safe-fetch';

/**
 * Running one synthetic check (§14).
 *
 * Every request goes through `safeFetch`, which resolves the hostname, refuses a non-public address and
 * pins the connection to the address it checked. That is not a nicety: **users type these URLs**, and
 * without the guard a synthetic check is a request-forgery tool with a scheduler attached. The guard is
 * re-applied after every redirect, because a redirect to `169.254.169.254` is the whole attack.
 *
 * This file deliberately has no way to disable certificate verification. §14 says there is no such option
 * anywhere, and the absence is the feature.
 */

/** §14's hard timeout. A check that hangs must not hold a collector cycle open. */
export const RUN_TIMEOUT_MS = 10_000;
/** §14: at most a megabyte is read, whatever the server claims. */
export const MAX_READ_BYTES = 1024 * 1024;

export type RunInput = {
  url: string;
  method: 'GET' | 'HEAD' | 'POST';
  assertions: readonly Assertion[];
  /** Decrypted by the caller. Never logged, never returned. */
  headers?: Record<string, string>;
};

export type RunResult = {
  ok: boolean;
  status: number | null;
  totalMs: number | null;
  bodyBytes: number | null;
  failureReason: string | null;
  assertionResults: AssertionResult[];
};

export type RunDeps = {
  fetch?: typeof safeFetch;
  now?: () => number;
};

/** Reads at most §14's cap, so a server that streams forever cannot exhaust the host. */
async function readCapped(response: Response): Promise<{ text: string; bytes: number }> {
  const buffer = await response.arrayBuffer();
  const bytes = buffer.byteLength;
  const slice = bytes > MAX_READ_BYTES ? buffer.slice(0, MAX_READ_BYTES) : buffer;
  return { text: new TextDecoder().decode(slice).slice(0, MAX_BODY_BYTES), bytes };
}

export async function runCheck(input: RunInput, deps: RunDeps = {}): Promise<RunResult> {
  const send = deps.fetch ?? safeFetch;
  const now = deps.now ?? (() => Date.now());
  const started = now();

  const empty: RunResult = {
    ok: false,
    status: null,
    // Null, not zero: a run that never connected did not take no time, it measured nothing.
    totalMs: null,
    bodyBytes: null,
    failureReason: null,
    assertionResults: [],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);
  try {
    const response = await send(input.url, {
      method: input.method,
      headers: input.headers,
      signal: controller.signal,
    });

    const { text, bytes } = input.method === 'HEAD' ? { text: '', bytes: 0 } : await readCapped(response);
    const results = input.assertions.map((assertion) =>
      evaluateAssertion(assertion, { status: response.status, body: input.method === 'HEAD' ? null : text }),
    );

    return {
      // With no assertions at all, a 2xx is the check: somebody who declared none meant "is it answering".
      ok: input.assertions.length === 0 ? response.ok : runPassed(results),
      status: response.status,
      totalMs: now() - started,
      bodyBytes: bytes,
      failureReason: null,
      assertionResults: results,
    };
  } catch (error) {
    // The guard refusing a target is a *configuration* answer, not an outage, and is named as such so the
    // page can say "this URL points somewhere OpsWatch will not fetch" rather than "your service is down".
    if (error instanceof SsrfError) return { ...empty, failureReason: `refused_${error.reason}` };
    if (controller.signal.aborted) return { ...empty, failureReason: 'timeout' };
    return { ...empty, failureReason: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
