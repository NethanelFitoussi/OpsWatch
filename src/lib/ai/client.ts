import 'server-only';
import { SsrfError, safeFetch } from '../net/safe-fetch';
import type { AiFailure } from './failures';
import { AI_PROVIDER_SPECS, endpointOf, type AiConfig } from './providers';

/**
 * Sending one request to whichever provider the operator configured.
 *
 * Everything that could carry a secret is confined here. The key is passed as an argument and put into a
 * header; it is never logged, never returned, and never part of a thrown error — `AiFailure` is a closed
 * set of codes, so nothing a provider says can end up in a message that reaches a page (§12.6).
 *
 * The request goes through `safeFetch` because `openai-compatible` lets an operator name the endpoint, and
 * an operator-supplied URL is attacker-influenced input the moment one of them is careless.
 */

/** How long one call may take. A page waiting on a model must not wait for ever. */
const AI_TIMEOUT_MS = 30_000;

/** A test costs one token, because its question is "does this key work", not "is the model good". */
const TEST_MAX_TOKENS = 1;


export type AiResult = { ok: true; text: string; model: string } | { ok: false; error: AiFailure };

export type AiRequest = {
  system: string;
  prompt: string;
  maxTokens: number;
};

/**
 * The body each API shape expects. Pure, so the shape is testable without a network.
 *
 * It is not given the key, and that is the guarantee rather than a convention: a request body logged by a
 * proxy cannot carry a credential this function has no access to.
 */
export function bodyFor(config: AiConfig, request: AiRequest): Record<string, unknown> {
  if (AI_PROVIDER_SPECS[config.provider].api === 'anthropic-messages') {
    return {
      model: config.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: [{ role: 'user', content: request.prompt }],
    };
  }
  return {
    model: config.model,
    max_completion_tokens: request.maxTokens,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.prompt },
    ],
  };
}

/** The headers each shape expects. The key is a value here and nowhere else. */
export function headersFor(config: AiConfig, apiKey: string): Record<string, string> {
  if (AI_PROVIDER_SPECS[config.provider].api === 'anthropic-messages') {
    return { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
  }
  return { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` };
}

/** The answer, out of either shape. `null` when the provider replied with something unrecognisable. */
export function textOf(config: AiConfig, payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const body = payload as Record<string, unknown>;

  if (AI_PROVIDER_SPECS[config.provider].api === 'anthropic-messages') {
    const content = body.content;
    if (!Array.isArray(content)) return null;
    const parts = content
      .filter((part): part is { type: string; text: string } => typeof part === 'object' && part !== null && typeof (part as { text?: unknown }).text === 'string')
      .map((part) => part.text);
    return parts.length === 0 ? null : parts.join('');
  }

  const choices = body.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  return typeof message?.content === 'string' ? message.content : null;
}

/** An HTTP status into one of the closed codes. A provider's own wording never reaches a reader. */
export function failureOf(status: number): AiFailure {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate_limited';
  return 'bad_response';
}

export type AiDeps = { fetch?: typeof safeFetch; timeoutMs?: number };

export async function callAi(config: AiConfig, apiKey: string, request: AiRequest, deps: AiDeps = {}): Promise<AiResult> {
  const endpoint = endpointOf(config);
  if (endpoint === null) return { ok: false, error: 'not_configured' };

  const send = deps.fetch ?? safeFetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? AI_TIMEOUT_MS);

  try {
    const response = await send(endpoint, {
      method: 'POST',
      headers: headersFor(config, apiKey),
      body: JSON.stringify(bodyFor(config, request)),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, error: failureOf(response.status) };

    const payload: unknown = await response.json().catch(() => null);
    const text = textOf(config, payload);
    // A reply that parsed but said nothing recognisable is a bad response, not an empty answer: an empty
    // answer rendered as the assistant's opinion would be OpsWatch putting words in a model's mouth.
    return text === null ? { ok: false, error: 'bad_response' } : { ok: true, text, model: config.model };
  } catch (error) {
    // The endpoint was refused by the SSRF guard — an operator pointed this at their own network.
    if (error instanceof SsrfError) return { ok: false, error: 'refused_endpoint' };
    if (error instanceof Error && error.name === 'AbortError') return { ok: false, error: 'timeout' };
    // Anything else is a network failure. The cause is deliberately not carried: it can contain the URL.
    return { ok: false, error: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

/** §23's connection test: the smallest possible call, asked only to prove the credential works. */
export function testRequest(): AiRequest {
  return { system: 'Reply with the single word ok.', prompt: 'ok', maxTokens: TEST_MAX_TOKENS };
}
