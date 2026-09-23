'use server';

import { revalidatePath } from 'next/cache';
import { resolveLocale } from '@/i18n/routing';
import { removeAiConnection, saveAiConnection, testAiConnection } from '@/lib/ai/connection';
import { AI_PROVIDER_SPECS, MAX_MODEL_LENGTH, isProvider } from '@/lib/ai/providers';
import { auditedAdmin } from '@/lib/auth/audited';
import { getDb } from '@/lib/db/client';
import type { ActionState } from '@/lib/forms/action-state';
import { formString } from '@/lib/forms/form-data';
import { isAcceptableEndpoint } from './endpoint-guard';

/**
 * Configuring, testing and removing the AI provider (AI-2, AI-3).
 *
 * The key arrives here, is encrypted and is never sent back. Nothing in this file returns it, echoes it
 * into a form value, or puts it in an error — a failure is a code from a closed list, so a provider that
 * echoes a key into its own error message cannot get it onto a page (§12.6).
 */

export type AiState = ActionState<
  'invalid_provider' | 'invalid_model' | 'invalid_base_url' | 'invalid_key' | 'not_configured' | 'unauthorized' | 'rate_limited' | 'unreachable' | 'refused_endpoint' | 'bad_response' | 'timeout',
  { saved?: boolean; tested?: boolean; removed?: boolean }
>;

/** A key is opaque: OpsWatch checks only that it is plausible, never what it means. */
const KEY = /^[\x21-\x7e]{16,500}$/;

export async function saveAiAction(locale: string, _prev: AiState, formData: FormData): Promise<AiState> {
  return auditedAdmin(resolveLocale(locale), 'ai_update', 'ai', async (): Promise<AiState> => {
    const provider = formString(formData, 'provider').trim();
    if (!isProvider(provider)) return { error: 'invalid_provider' };

    const model = formString(formData, 'model').trim();
    if (model === '' || model.length > MAX_MODEL_LENGTH) return { error: 'invalid_model' };

    const spec = AI_PROVIDER_SPECS[provider];
    const baseUrl = formString(formData, 'baseUrl').trim();
    if (spec.customBaseUrl) {
      // Refused before it is stored. A provider URL nobody can reach should not sit in the database
      // looking configured, and one pointing inside the network should not be stored at all.
      if (!isAcceptableEndpoint(baseUrl)) return { error: 'invalid_base_url' };
    }

    const apiKey = formString(formData, 'apiKey').trim();
    // An empty key means "keep the stored one", which is how a model can be changed without retyping it.
    if (apiKey !== '' && !KEY.test(apiKey)) return { error: 'invalid_key' };

    saveAiConnection(
      getDb(),
      {
        provider,
        model,
        ...(spec.customBaseUrl ? { baseUrl } : {}),
        ...(apiKey === '' ? {} : { apiKey }),
      },
      Date.now(),
    );
    revalidatePath(`/${resolveLocale(locale)}/settings/ai`);
    return { saved: true };
  });
}

export async function testAiAction(locale: string, _prev: AiState, _formData: FormData): Promise<AiState> {
  return auditedAdmin(resolveLocale(locale), 'ai_test', 'ai', async (): Promise<AiState> => {
    const result = await testAiConnection(getDb(), Date.now());
    revalidatePath(`/${resolveLocale(locale)}/settings/ai`);
    return result.ok ? { tested: true } : { error: result.error };
  });
}

export async function removeAiAction(locale: string, _prev: AiState, _formData: FormData): Promise<AiState> {
  return auditedAdmin(resolveLocale(locale), 'ai_update', 'ai', async (): Promise<AiState> => {
    // Disconnect means the key is gone, not that a flag was flipped.
    removeAiConnection(getDb());
    revalidatePath(`/${resolveLocale(locale)}/settings/ai`);
    return { removed: true };
  });
}
