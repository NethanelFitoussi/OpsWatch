import 'server-only';
import type { AiAnswer } from '@opswatch/contract';
import { randomId } from '../crypto';
import type { Db } from '../db/client';
import type { ReadContext } from '../read/problems';
import { runAi } from './connection';
import type { AiFailure } from './failures';
import { buildEvidence, hasEvidence } from './evidence';

/**
 * Ask OpsWatch (§23, AI-5).
 *
 * **The assistant narrates; it never measures.** Everything it is given was already computed by the
 * deterministic engine — §2.2's ruling, and the reason the answer is presented as the fourth of four
 * things a reader sees rather than as the first:
 *
 *   1. Observed evidence — what OpsWatch recorded, with timestamps.
 *   2. Correlations — facts near each other, with the gap stated.
 *   3. AI hypothesis — this. A guess, labelled as one.
 *   4. Suggested investigation — what would settle it.
 *
 * The system prompt is the other half of that promise. A model asked for an answer will produce one; it is
 * told, in the instruction it cannot see around, that it may not invent a figure, may not claim a cause,
 * and must say when the evidence does not support an answer.
 */

/** How long an answer may be. A paragraph a reader will actually read, not an essay nobody checks. */
const MAX_TOKENS = 600;

/** A question longer than this is a document, and a document is not a question. */
export const MAX_QUESTION_LENGTH = 500;

/**
 * What the model is told it is, every time.
 *
 * Written as prohibitions because that is what it is for: the deterministic half of OpsWatch already refuses
 * to state a figure it did not measure, and this is how the same rule survives contact with a model.
 */
export const SYSTEM_PROMPT = [
  'You are the assistant inside OpsWatch, an infrastructure monitoring tool.',
  'You are given evidence OpsWatch has already measured. You may only reason from it.',
  '',
  'Rules you must follow:',
  '- Never state a number, a service name or a time that is not in the evidence.',
  '- Never say one thing caused another. You may say two things happened close together, and say how close.',
  '- If the evidence does not support an answer, say exactly that and say what would.',
  '- Refer to a problem, a deployment or an error group by the id given, so the reader can open it.',
  '- Be brief. A short paragraph, or a few short ones.',
  '- You are reading the estate, not changing it. Never suggest a command, and never claim to have acted.',
].join('\n');

export type AskResult =
  | { ok: true; answer: AiAnswer }
  | { ok: false; error: AiFailure | 'no_evidence' | 'invalid_question' };

export async function askOpsWatch(
  db: Db,
  query: { connectionId: string; scope: string; question: string },
  context: ReadContext,
  deps: Parameters<typeof runAi>[2] = {},
): Promise<AskResult> {
  const question = query.question.trim();
  if (question === '' || question.length > MAX_QUESTION_LENGTH) return { ok: false, error: 'invalid_question' };

  const evidence = buildEvidence(db, { connectionId: query.connectionId, scope: query.scope }, context);
  // Nothing measured, nothing to narrate. Asking a model anyway would get a confident answer about an
  // environment nobody has read, which is the one failure this whole product is arranged to avoid.
  if (!hasEvidence(evidence)) return { ok: false, error: 'no_evidence' };

  const result = await runAi(
    db,
    {
      system: SYSTEM_PROMPT,
      prompt: [`Question: ${question}`, '', 'Evidence:', evidence.text].join('\n'),
      maxTokens: MAX_TOKENS,
    },
    deps,
  );
  if (!result.ok) return { ok: false, error: result.error };

  return {
    ok: true,
    answer: {
      id: randomId(),
      answer: result.text,
      generatedAt: context.nowMs,
      // Only what the evidence carried. A citation the model invented would point nowhere.
      citations: evidence.citations,
      model: result.model,
    },
  };
}
