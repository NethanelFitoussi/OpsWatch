import 'server-only';
import { env } from '../env';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, sign, type AlertPayload } from './payload';

/**
 * Sending one webhook.
 *
 * §15's promise is that nothing leaves the instance until an operator asks for it, so this is only ever
 * reached through a destination somebody created. The request is bounded by a timeout, because a
 * receiver that never answers must not hold a collector cycle open.
 *
 * A non-2xx is a failure with its status recorded. A network error is a failure with its cause recorded.
 * Neither throws: the caller is a retry loop, not an error handler.
 */

const DELIVERY_TIMEOUT_MS = 10_000;
/** Four attempts over roughly half an hour, then it stays failed and visible. */
export const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [60_000, 5 * 60_000, 25 * 60_000];

export function nextAttemptAt(attempts: number, nowMs: number): number | null {
  const wait = BACKOFF_MS[attempts - 1];
  return wait === undefined ? null : nowMs + wait;
}

export type DeliveryOutcome = { ok: boolean; status?: number; error?: string };

export type DeliveryDeps = { fetch?: typeof fetch; nowMs?: number };

export async function deliver(destination: { url: string }, payload: AlertPayload, secret: string, deps: DeliveryDeps = {}): Promise<DeliveryOutcome> {
  const send = deps.fetch ?? fetch;
  const nowMs = deps.nowMs ?? Date.now();
  // The exact bytes that are signed are the exact bytes that are sent: serialising twice would let the
  // two drift, and a receiver would be verifying a string it never saw.
  const body = JSON.stringify(payload);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  try {
    const response = await send(destination.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [TIMESTAMP_HEADER]: String(nowMs),
        [SIGNATURE_HEADER]: sign(nowMs, body, secret),
        'user-agent': 'OpsWatch',
      },
      body,
      signal: controller.signal,
      redirect: 'error',
    });
    return response.ok ? { ok: true, status: response.status } : { ok: false, status: response.status, error: `http_${response.status}` };
  } catch (error) {
    // The receiver's own words are not repeated: a URL or a certificate message in an audit log is one
    // more place a secret can end up. The class of failure is enough to act on.
    return { ok: false, error: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/** The absolute link into this installation, or null when no public URL is configured. */
export function alertUrl(connectionId: string, scope: string, problemId: string | null): string | null {
  const base = env().OPSWATCH_PUBLIC_URL;
  if (base === undefined || base.length === 0) return null;
  const path = problemId === null ? `/c/${connectionId}/${scope}/overview/alerts` : `/c/${connectionId}/${scope}/overview/problems/${problemId}`;
  return `${base.replace(/\/$/, '')}${path}`;
}
