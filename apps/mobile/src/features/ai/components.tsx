/**
 * Ask OpsWatch building blocks: the "AI is optional" state, the context chip, question bubbles and answer cards.
 */
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import type { AiAnswer, Ref } from '@/api/contract';
import { useOpenRef } from '@/features/shared/navigation';
import { useI18n, type MessageKey } from '@/i18n';
import { routeForRef } from '@/lib/deep-links';
import { Button } from '@/ui/controls';
import { Card } from '@/ui/layout';
import { ScrollScreen } from '@/ui/screen';
import { errorMessageKey } from '@/ui/states';
import { Text } from '@/ui/text';
import { radius, spacing } from '@/ui/theme';
import { useTheme } from '@/ui/theme-provider';

export function refTypeLabel(t: (key: MessageKey) => string, type: Ref['type']): string {
  return t(`search.type.${type}` as MessageKey);
}

/** Shown when the server has no AI provider configured. AI is an add-on: nothing else depends on it. */
export function AiOptionalState() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const points: { icon: 'key-outline' | 'checkmark-done-outline'; text: MessageKey }[] = [
    { icon: 'key-outline', text: 'ai.disabledKeys' },
    { icon: 'checkmark-done-outline', text: 'ai.disabledRest' },
  ];
  return (
    <ScrollScreen testID="ask-disabled">
      <View style={styles.disabledHead}>
        <Ionicons name="sparkles-outline" size={40} color={colors.textFaint} importantForAccessibility="no" />
        <Text variant="title" accessibilityRole="header" style={styles.center}>
          {t('ai.disabledTitle')}
        </Text>
        <Text tone="muted" style={styles.center}>
          {t('ai.disabledBody')}
        </Text>
      </View>
      <Card>
        <View style={{ gap: spacing.md }}>
          {points.map((point) => (
            <View key={point.text} style={styles.point}>
              <Ionicons name={point.icon} size={18} color={colors.textMuted} importantForAccessibility="no" />
              <Text style={{ flex: 1 }}>{t(point.text)}</Text>
            </View>
          ))}
        </View>
      </Card>
    </ScrollScreen>
  );
}

/** "About: Problem prb-checkout-5xx", removable. */
export function ContextChip({ context, onRemove }: { context: Pick<Ref, 'type' | 'id'>; onRemove: () => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const type = refTypeLabel(t, context.type);
  return (
    <View style={[styles.contextChip, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]} testID="ask-context">
      <Ionicons name="link-outline" size={14} color={colors.textMuted} importantForAccessibility="no" />
      <Text variant="small" weight="600" style={{ flexShrink: 1 }} numberOfLines={1}>
        {t('ai.about', { type, id: context.id })}
      </Text>
      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={t('ai.removeContext', { type, id: context.id })}
        hitSlop={12}
        testID="ask-context-remove"
        style={styles.chipRemove}
      >
        <Ionicons name="close-circle" size={18} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

export function QuestionBubble({ text }: { text: string }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <View style={[styles.bubble, { backgroundColor: colors.primary }]} accessible accessibilityLabel={`${t('ai.you')}: ${text}`}>
      <Text style={{ color: colors.onPrimary }} selectable>
        {text}
      </Text>
    </View>
  );
}

export function PendingAnswer() {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <Card>
      <View style={styles.point} accessibilityRole="progressbar" accessibilityLabel={t('ai.thinking')} testID="ask-pending">
        <ActivityIndicator color={colors.primary} />
        <Text tone="muted" style={{ flex: 1 }}>
          {t('ai.thinking')}
        </Text>
      </View>
    </Card>
  );
}

export function FailedAnswer({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <Card accent={colors.critical}>
      <View style={{ gap: spacing.sm }} accessibilityLiveRegion="polite" testID="ask-error">
        <Text weight="600">{t('ai.failed')}</Text>
        <Text variant="small" tone="muted">
          {t(errorMessageKey(error))}
        </Text>
        <View style={{ alignSelf: 'flex-start' }}>
          <Button label={t('action.retry')} onPress={onRetry} variant="secondary" icon="refresh" compact testID="ask-retry" />
        </View>
      </View>
    </Card>
  );
}

/** An answer, always labelled as AI-generated, with its cited evidence as links. */
export function AnswerCard({ answer }: { answer: AiAnswer }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const openRef = useOpenRef();
  return (
    <Card>
      <View style={{ gap: spacing.md }} testID={`ask-answer-${answer.id}`}>
        <View style={[styles.aiLabel, { backgroundColor: colors.warningBg }]} testID="ai-generated">
          <Ionicons name="sparkles" size={14} color={colors.warning} importantForAccessibility="no" />
          <Text variant="caption" weight="700" style={{ color: colors.warning, flex: 1 }}>
            {t('ai.generated')}
          </Text>
        </View>
        <Text selectable accessibilityLabel={`${t('ai.answer')}: ${answer.answer}`}>
          {answer.answer}
        </Text>
        <View style={{ gap: spacing.xs }}>
          <Text variant="label" tone="muted" accessibilityRole="header">
            {t('ai.citations').toUpperCase()}
          </Text>
          {answer.citations.length === 0 ? (
            <Text variant="small" tone="warning">
              {t('ai.noCitations')}
            </Text>
          ) : (
            answer.citations.map((ref) => {
              const reachable = routeForRef(ref) !== null;
              const label = ref.label ?? `${refTypeLabel(t, ref.type)} ${ref.id}`;
              return (
                <Pressable
                  key={`${ref.type}:${ref.id}`}
                  onPress={reachable ? () => openRef(ref) : undefined}
                  disabled={!reachable}
                  accessibilityRole={reachable ? 'link' : 'text'}
                  accessibilityLabel={label}
                  testID={`ask-citation-${ref.type}-${ref.id}`}
                  style={styles.citation}
                >
                  <Ionicons name="document-text-outline" size={14} color={reachable ? colors.primary : colors.textMuted} importantForAccessibility="no" />
                  <Text variant="small" weight="600" tone={reachable ? 'primary' : 'muted'} style={{ flex: 1 }}>
                    {label}
                  </Text>
                  {reachable ? <Ionicons name="arrow-forward" size={14} color={colors.primary} importantForAccessibility="no" /> : null}
                </Pressable>
              );
            })
          )}
        </View>
        {answer.model ? (
          <Text variant="caption" tone="faint">
            {t('ai.model', { model: answer.model })}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  disabledHead: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  center: { textAlign: 'center', maxWidth: 480 },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  contextChip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingLeft: spacing.md, paddingRight: 4, minHeight: 36, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, maxWidth: '100%' },
  chipRemove: { padding: 6 },
  bubble: { alignSelf: 'flex-end', maxWidth: '88%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg },
  aiLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.md },
  citation: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
});
