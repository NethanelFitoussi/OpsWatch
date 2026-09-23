'use server';

import { resolveLocale } from '@/i18n/routing';
import { askOpsWatch } from '@/lib/ai/ask';
import { requireAdmin } from '@/lib/auth/current';
import { getDb } from '@/lib/db/client';
import type { ActionState } from '@/lib/forms/action-state';
import { formString } from '@/lib/forms/form-data';
import { insightRenderer } from '@/lib/read/render';

/**
 * Asking the assistant one question (§23, AI-5).
 *
 * The answer is returned to the page as text and citations, and the page renders it as the **fourth** of
 * four things — after the evidence and the correlations, labelled as a hypothesis. Nothing here decides
 * anything, and nothing here writes anything: it is a read with a model in the middle.
 */

export type AskState = ActionState<
  'invalid_question' | 'no_evidence' | 'not_configured' | 'unauthorized' | 'rate_limited' | 'unreachable' | 'refused_endpoint' | 'bad_response' | 'timeout',
  { answer?: string; citations?: { type: string; id: string; label: string }[]; model?: string; question?: string }
>;

export async function askAction(
  locale: string,
  connectionId: string,
  region: string,
  _prev: AskState,
  formData: FormData,
): Promise<AskState> {
  await requireAdmin(resolveLocale(locale));
  const question = formString(formData, 'question').trim();

  const result = await askOpsWatch(
    getDb(),
    { connectionId, scope: region, question },
    { nowMs: Date.now(), render: await insightRenderer(resolveLocale(locale)) },
  );
  if (!result.ok) return { error: result.error, question };

  return {
    question,
    answer: result.answer.answer,
    ...(result.answer.model === undefined ? {} : { model: result.answer.model }),
    // Exactly what the evidence carried. A citation the model invented would point nowhere.
    citations: result.answer.citations.map((ref) => ({ type: ref.type, id: ref.id, label: ref.label ?? ref.id })),
  };
}
