/**
 * Which AI providers OpsWatch can talk to, and how each one is addressed.
 *
 * Client-safe: the settings form offers these choices in the browser, so nothing here touches the network,
 * the database or a credential. The request each provider needs is *described* here and *sent* by
 * `lib/ai/client.ts`, which is server-only and goes through the SSRF guard like every other outbound call.
 *
 * **An abstraction rather than a vendor.** §2.2 puts AI last and keeps it optional, which only stays true
 * if swapping providers is a setting rather than a rewrite — and if an operator can point OpsWatch at
 * something they run themselves.
 */

export const AI_PROVIDERS = ['anthropic', 'openai', 'openai-compatible'] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

export type AiProviderSpec = {
  id: AiProviderId;
  /** The default endpoint, or null when the operator names their own. */
  baseUrl: string | null;
  /** Whether the operator supplies the base URL, which is what makes a self-hosted model possible. */
  customBaseUrl: boolean;
  /** A model that exists, offered so the first save does not require reading a vendor's documentation. */
  suggestedModel: string;
  /** Which request shape the endpoint speaks. Two shapes cover every provider here. */
  api: 'anthropic-messages' | 'openai-chat';
};

export const AI_PROVIDER_SPECS: Record<AiProviderId, AiProviderSpec> = {
  anthropic: {
    id: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    customBaseUrl: false,
    suggestedModel: 'claude-sonnet-5',
    api: 'anthropic-messages',
  },
  openai: {
    id: 'openai',
    baseUrl: 'https://api.openai.com',
    customBaseUrl: false,
    suggestedModel: 'gpt-4.1-mini',
    api: 'openai-chat',
  },
  // A self-hosted model, a gateway, or any vendor that speaks the same shape. The operator names the
  // endpoint, which is exactly why the request goes through the SSRF guard rather than plain `fetch`.
  'openai-compatible': {
    id: 'openai-compatible',
    baseUrl: null,
    customBaseUrl: true,
    suggestedModel: 'llama-3.3-70b',
    api: 'openai-chat',
  },
};

export function isProvider(value: string): value is AiProviderId {
  return (AI_PROVIDERS as readonly string[]).includes(value);
}

/** The non-secret half of an AI connection: what it is, never the key that reaches it. */
export type AiConfig = {
  provider: AiProviderId;
  model: string;
  /** Only for `openai-compatible`, where the operator names their own endpoint. */
  baseUrl?: string;
};

export const MAX_MODEL_LENGTH = 100;

/** Where a config's requests go. Falls back to the provider's own endpoint when none was supplied. */
export function endpointOf(config: AiConfig): string | null {
  const spec = AI_PROVIDER_SPECS[config.provider];
  const base = spec.customBaseUrl ? (config.baseUrl ?? null) : spec.baseUrl;
  if (base === null || base === '') return null;
  return `${base.replace(/\/+$/, '')}${spec.api === 'anthropic-messages' ? '/v1/messages' : '/v1/chat/completions'}`;
}
