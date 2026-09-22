/**
 * The Ask OpsWatch conversation. The conversation lives in component state only: it is never cached, persisted or
 * restored, and it disappears when the screen closes.
 */
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AiAnswer, Ref } from '@/api/contract';
import { useAsk } from '@/api/queries';
import { useI18n } from '@/i18n';
import { Button, Chip, TextField } from '@/ui/controls';
import { Section } from '@/ui/layout';
import { MAX_CONTENT_WIDTH } from '@/ui/screen';
import { Text } from '@/ui/text';
import { spacing } from '@/ui/theme';
import { useTheme } from '@/ui/theme-provider';
import { isApiError } from '@/api/errors';
import { AnswerCard, CancelledAnswer, ContextChip, FailedAnswer, PendingAnswer, QuestionBubble } from './components';
import { canAsk, clampQuestion, MAX_QUESTION_LENGTH, SUGGESTED_QUESTIONS } from './helpers';

type Turn = {
  key: number;
  question: string;
  context: Pick<Ref, 'type' | 'id'> | null;
  state: { status: 'pending' } | { status: 'done'; answer: AiAnswer } | { status: 'error'; error: unknown } | { status: 'cancelled' };
};

export function AskScreen({ initialContext, initialQuestion }: { initialContext: Pick<Ref, 'type' | 'id'> | null; initialQuestion: string }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const ask = useAsk();
  const scroll = useRef<ScrollView>(null);
  const nextKey = useRef(0);
  const [context, setContext] = useState(initialContext);
  const [text, setText] = useState(initialQuestion);
  const [turns, setTurns] = useState<Turn[]>([]);
  const busy = turns.some((turn) => turn.state.status === 'pending');

  const run = async (key: number, question: string, turnContext: Turn['context']) => {
    const setState = (state: Turn['state']) => setTurns((current) => current.map((turn) => (turn.key === key ? { ...turn, state } : turn)));
    setState({ status: 'pending' });
    try {
      const answer = await ask.mutateAsync({ question, context: turnContext ?? undefined });
      setState({ status: 'done', answer });
    } catch (error) {
      // Giving up on an answer is not a failure worth a red card.
      setState(isApiError(error) && error.kind === 'cancelled' ? { status: 'cancelled' } : { status: 'error', error });
    }
  };

  const submit = (raw: string) => {
    const question = clampQuestion(raw.trim());
    if (!canAsk(question, busy)) return;
    const key = nextKey.current++;
    setTurns((current) => [...current, { key, question, context, state: { status: 'pending' } }]);
    setText('');
    void run(key, question, context);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
    >
      <ScrollView
        ref={scroll}
        testID="ask-screen"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          if (turns.length) scroll.current?.scrollToEnd({ animated: true });
        }}
      >
        <View style={styles.inner}>
          {turns.length === 0 ? (
            <>
              <Text tone="muted">{t('ai.intro')}</Text>
              <Section title={t('ai.suggestions')}>
                <View style={styles.suggestions}>
                  {SUGGESTED_QUESTIONS.map((key) => (
                    <Chip key={key} label={t(key)} selected={false} icon="sparkles-outline" onPress={() => submit(t(key))} testID={`ask-suggestion-${key.slice('ai.suggest.'.length)}`} />
                  ))}
                </View>
              </Section>
            </>
          ) : null}
          {turns.map((turn) => (
            <View key={turn.key} style={styles.turn}>
              <QuestionBubble text={turn.question} />
              {turn.state.status === 'pending' ? <PendingAnswer onCancel={ask.cancel} /> : null}
              {turn.state.status === 'cancelled' ? <CancelledAnswer onRetry={() => void run(turn.key, turn.question, turn.context)} /> : null}
              {turn.state.status === 'done' ? <AnswerCard answer={turn.state.answer} /> : null}
              {turn.state.status === 'error' ? <FailedAnswer error={turn.state.error} onRetry={() => void run(turn.key, turn.question, turn.context)} /> : null}
            </View>
          ))}
          <Text variant="caption" tone="faint">
            {t('ai.privacy')}
          </Text>
        </View>
      </ScrollView>
      <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        <View style={styles.composerInner}>
          {context ? <ContextChip context={context} onRemove={() => setContext(null)} /> : null}
          <TextField
            label={t('ai.questionLabel')}
            placeholder={t('ai.placeholder')}
            value={text}
            onChangeText={(value) => setText(clampQuestion(value))}
            maxLength={MAX_QUESTION_LENGTH}
            multiline
            returnKeyType="send"
            submitBehavior="submit"
            onSubmitEditing={() => submit(text)}
            testID="ask-input"
            style={styles.input}
          />
          <View style={styles.actions}>
            <Text variant="caption" tone={text.length >= MAX_QUESTION_LENGTH ? 'warning' : 'faint'} testID="ask-counter" accessibilityLiveRegion="polite">
              {t('ai.counter', { count: text.length, max: MAX_QUESTION_LENGTH })}
            </Text>
            <Button label={t('ai.ask')} icon="send" onPress={() => submit(text)} disabled={!canAsk(text, busy)} loading={busy} compact testID="ask-submit" />
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingVertical: spacing.md },
  inner: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', paddingHorizontal: spacing.lg, gap: spacing.lg },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  turn: { gap: spacing.sm },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm },
  composerInner: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', paddingHorizontal: spacing.lg, gap: spacing.sm },
  input: { maxHeight: 120 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
});
