/**
 * Pure helpers for Ask OpsWatch: route parameter validation, question limits and the suggested questions.
 */
import { REF_TYPES, type Ref, type RefType } from '@/api/contract';
import type { MessageKey } from '@/i18n';
import { isSafeId } from '@/lib/deep-links';

export const MAX_QUESTION_LENGTH = 500;

export const SUGGESTED_QUESTIONS: readonly MessageKey[] = [
  'ai.suggest.unhealthy',
  'ai.suggest.today',
  'ai.suggest.biggest',
  'ai.suggest.checkout',
  'ai.suggest.redis',
  'ai.suggest.deployment',
  'ai.suggest.summary',
];

function single(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

export function isRefType(value: unknown): value is RefType {
  return typeof value === 'string' && (REF_TYPES as readonly string[]).includes(value);
}

/**
 * The context an ask screen was opened with (`contextType` + `contextId`), or null when either is missing or unsafe.
 * Only a type and an id ever leave the device: never a label or any content.
 */
export function parseAskContext(params: { contextType?: unknown; contextId?: unknown }): Pick<Ref, 'type' | 'id'> | null {
  const type = single(params.contextType);
  const id = single(params.contextId);
  if (!isRefType(type) || !isSafeId(id)) return null;
  return { type, id };
}

/** A prefilled question from a route parameter: a string, trimmed of leading space and capped at the length limit. */
export function parseInitialQuestion(value: unknown): string {
  const question = single(value);
  return typeof question === 'string' ? clampQuestion(question.trimStart()) : '';
}

export function clampQuestion(text: string): string {
  return text.length > MAX_QUESTION_LENGTH ? text.slice(0, MAX_QUESTION_LENGTH) : text;
}

export function canAsk(text: string, busy: boolean): boolean {
  const trimmed = text.trim();
  return !busy && trimmed.length > 0 && trimmed.length <= MAX_QUESTION_LENGTH;
}
