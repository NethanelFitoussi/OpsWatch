import 'server-only';
import { DecryptionError, decrypt, encrypt } from '../crypto';
import type { Db } from '../db/client';
import { env } from '../env';
import { credentialFor, deleteIntegration, listIntegrations, recordIntegrationTest, upsertIntegration } from '../store/repositories';
import { callAi, testRequest, type AiResult } from './client';
import type { AiFailure } from './failures';
import { AI_PROVIDER_SPECS, isProvider, type AiConfig, type AiProviderId } from './providers';

/**
 * The one AI connection an instance may have (AI-2, AI-3).
 *
 * **Off by default and optional for ever.** Nothing in OpsWatch asks this file a question unless an
 * operator configured a provider, and every surface that could use AI works without it — §2.2 puts
 * deterministic analysis first and AI second, over a bounded context, or not at all.
 *
 * The key is encrypted under its own purpose-scoped derivation, so an AI key cannot be decrypted by
 * anything that handles AWS credentials and vice versa. It is written by `save`, read by `run`, and
 * returned by neither.
 */

/** Only one provider is configured at a time: "which model answers" is not a question with two answers. */
const NAME = 'default';
const PURPOSE = 'ai-provider' as const;

/** What a page may see: the provider, the model, the status. Never the key, not even its length. */
export type AiConnectionView = {
  provider: AiProviderId;
  model: string;
  /** Present only for a provider whose endpoint the operator names. Not a secret, and useful to confirm. */
  baseUrl: string | null;
  status: 'configured' | 'untested' | 'failed';
  lastTestedAt: number | null;
  /** A failure code from the closed list, never a provider's own words. */
  lastError: string | null;
};

function parseConfig(config: unknown): AiConfig | null {
  if (typeof config !== 'object' || config === null) return null;
  const { provider, model, baseUrl } = config as Record<string, unknown>;
  if (typeof provider !== 'string' || !isProvider(provider)) return null;
  if (typeof model !== 'string' || model === '') return null;
  return { provider, model, ...(typeof baseUrl === 'string' && baseUrl !== '' ? { baseUrl } : {}) };
}

/** The configured connection, or null when nobody has configured one. Null is the default and stays it. */
export function readAiConnection(db: Db): AiConnectionView | null {
  const row = listIntegrations(db, 'ai').find((one) => one.name === NAME);
  if (row === undefined) return null;
  const config = parseConfig(row.config);
  if (config === null) return null;
  return {
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl ?? null,
    status: row.status,
    lastTestedAt: row.lastTestedAt,
    lastError: row.lastError,
  };
}

/** Whether AI is genuinely usable: configured, tested and passing. A saved key that failed is not ready. */
export function aiIsReady(db: Db): boolean {
  return readAiConnection(db)?.status === 'configured';
}

export type SaveAiInput = {
  provider: AiProviderId;
  model: string;
  baseUrl?: string;
  /** Absent means "keep the stored key", which is how a model can be changed without retyping a secret. */
  apiKey?: string;
};

export function saveAiConnection(db: Db, input: SaveAiInput, nowMs: number): AiConnectionView | null {
  const spec = AI_PROVIDER_SPECS[input.provider];
  const config: AiConfig = {
    provider: input.provider,
    model: input.model,
    ...(spec.customBaseUrl && input.baseUrl !== undefined && input.baseUrl !== '' ? { baseUrl: input.baseUrl } : {}),
  };
  upsertIntegration(
    db,
    {
      kind: 'ai',
      name: NAME,
      config: config as unknown as Record<string, unknown>,
      ...(input.apiKey === undefined ? {} : { credentialCiphertext: encrypt(input.apiKey, env().OPSWATCH_SECRET, PURPOSE) }),
    },
    nowMs,
  );
  return readAiConnection(db);
}

/** Forgets the provider and the key together. Nothing is kept "for the history". */
export function removeAiConnection(db: Db): boolean {
  const row = listIntegrations(db, 'ai').find((one) => one.name === NAME);
  if (row === undefined) return false;
  return deleteIntegration(db, row.id) > 0;
}

/** Whether a key has been stored at all, which is different from whether it works. */
export function aiHasCredential(db: Db): boolean {
  return listIntegrations(db, 'ai').find((one) => one.name === NAME)?.hasCredential === true;
}

type Deps = Parameters<typeof callAi>[3];

/**
 * Runs one request against the configured provider.
 *
 * The decrypted key exists only inside this function's frame and is handed straight to the client. A
 * failure to decrypt is `unauthorized` rather than a crash: a key encrypted under a different
 * `OPSWATCH_SECRET` is unusable, which is exactly what an operator needs to be told.
 */
export async function runAi(db: Db, request: Parameters<typeof callAi>[2], deps: Deps = {}): Promise<AiResult> {
  const row = listIntegrations(db, 'ai').find((one) => one.name === NAME);
  if (row === undefined) return { ok: false, error: 'not_configured' };
  const config = parseConfig(row.config);
  if (config === null) return { ok: false, error: 'not_configured' };

  const ciphertext = credentialFor(db, row.id);
  if (ciphertext === null) return { ok: false, error: 'not_configured' };

  let apiKey: string;
  try {
    apiKey = decrypt(ciphertext, env().OPSWATCH_SECRET, PURPOSE);
  } catch (error) {
    if (error instanceof DecryptionError) return { ok: false, error: 'unauthorized' };
    throw error;
  }

  return callAi(config, apiKey, request, deps);
}

/** §23's connection test, recorded so the page can show connected, invalid or unavailable. */
export async function testAiConnection(db: Db, nowMs: number, deps: Deps = {}): Promise<{ ok: true } | { ok: false; error: AiFailure }> {
  const row = listIntegrations(db, 'ai').find((one) => one.name === NAME);
  if (row === undefined) return { ok: false, error: 'not_configured' };

  const result = await runAi(db, testRequest(), deps);
  // The code is stored, never the provider's sentence: a provider that echoes a key into its error message
  // must not be able to put it into the database or onto a page.
  recordIntegrationTest(db, row.id, result.ok ? { ok: true } : { ok: false, error: result.error }, nowMs);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
