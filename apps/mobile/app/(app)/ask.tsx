import { useLocalSearchParams } from 'expo-router';
import { AiOptionalState } from '@/features/ai/components';
import { AskScreen } from '@/features/ai/ask-screen';
import { parseAskContext, parseInitialQuestion } from '@/features/ai/helpers';
import { useFeature } from '@/state/session';

/** Ask OpsWatch. Optional: without a server-side AI provider the screen explains so, and nothing else changes. */
export default function AskRoute() {
  const params = useLocalSearchParams<{ contextType?: string; contextId?: string; question?: string }>();
  const enabled = useFeature('ai');
  if (!enabled) return <AiOptionalState />;
  const context = parseAskContext(params);
  const question = parseInitialQuestion(params.question);
  return <AskScreen key={`${context?.type ?? ''}:${context?.id ?? ''}:${question}`} initialContext={context} initialQuestion={question} />;
}
