/**
 * Error tracking building blocks: status badge, list row and the metadata lines shared by the list and the detail.
 */
import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { ErrorSummary } from '@/api/contract';
import { useOpenRef } from '@/features/shared/navigation';
import { useI18n } from '@/i18n';
import { Badge } from '@/ui/badges';
import { Text } from '@/ui/text';
import { monoFont, spacing, TOUCH_TARGET } from '@/ui/theme';
import { useTheme } from '@/ui/theme-provider';
import { useNow, useRelativeTime } from '@/ui/states';
import {
  errorStatusIcon,
  errorStatusLabelKey,
  errorStatusMeaningKey,
  errorStatusNeedsExplaining,
  errorStatusTone,
  formatCount,
  type ErrorStatus,
} from './helpers';

export function ErrorStatusBadge({ status, size }: { status: ErrorStatus; size?: 'small' | 'large' }) {
  const { t } = useI18n();
  return <Badge tone={errorStatusTone(status)} icon={errorStatusIcon(status)} label={t(errorStatusLabelKey(status))} size={size} testID={`error-status-${status}`} />;
}

/** "Occurrences: 2.4k" or "Occurrences: No data": a missing count is never shown as 0. */
export function useCountLabel() {
  const { t } = useI18n();
  return (label: string, value: number | null) => `${label}: ${formatCount(value) ?? t('metric.noData')}`;
}

/**
 * One line saying what the status means, in the status' own tone. Shown wherever the word alone would not say why it
 * matters — a regression is an error that had stopped and is happening again, which is not a new error.
 */
export function ErrorStatusMeaning({ status }: { status: ErrorStatus }) {
  const { t } = useI18n();
  return (
    <Text variant="caption" tone={status === 'regression' ? 'critical' : 'muted'} numberOfLines={2}>
      {t(errorStatusMeaningKey(status))}
    </Text>
  );
}

/**
 * A row that can be triaged without opening it: what broke (message), how bad (occurrences, instances), where
 * (service, route) and since when (first seen) next to how recent it is (last seen).
 */
export const ErrorRow = memo(function ErrorRow({ error }: { error: ErrorSummary }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const openRef = useOpenRef();
  const now = useNow();
  const relative = useRelativeTime();
  const countLabel = useCountLabel();
  // The type is dropped when the message already starts with it, which is the usual shape ("TypeError: …").
  const type = error.type && !error.message.startsWith(error.type) ? error.type : null;
  const where = [type, error.service?.label ?? error.service?.id, error.route].filter(Boolean).join(' · ');
  const occurrences = countLabel(t('metric.occurrences'), error.occurrences);
  const instances = countLabel(t('errors.instances'), error.affectedInstances);
  const when = `${t('errors.started', { time: relative(error.firstSeenAt, now) })} · ${t('time.lastSeen')} ${relative(error.lastSeenAt, now)}`;
  const status = t(errorStatusLabelKey(error.status));
  const explain = errorStatusNeedsExplaining(error.status);
  return (
    <Pressable
      onPress={() => openRef({ type: 'error', id: error.id })}
      accessibilityRole="button"
      accessibilityLabel={[status, explain ? t(errorStatusMeaningKey(error.status)) : null, error.message, where, occurrences, instances, when]
        .filter(Boolean)
        .join(', ')}
      testID={`errors-row-${error.id}`}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}
    >
      <View style={styles.body}>
        <View style={styles.head}>
          <ErrorStatusBadge status={error.status} />
          <Text variant="small" weight="700" style={styles.count} numberOfLines={1}>
            {occurrences}
          </Text>
          <Text variant="caption" tone="muted" style={styles.count} numberOfLines={1}>
            {instances}
          </Text>
        </View>
        {explain ? <ErrorStatusMeaning status={error.status} /> : null}
        <Text variant="small" weight="600" style={styles.message} numberOfLines={2}>
          {error.message}
        </Text>
        {where ? (
          <Text variant="small" tone="muted" numberOfLines={1}>
            {where}
          </Text>
        ) : null}
        <Text variant="caption" tone="faint" numberOfLines={2}>
          {when}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} importantForAccessibility="no" />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: TOUCH_TARGET + 8 },
  body: { flex: 1, gap: 4 },
  head: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  // Counts change between rows and between refreshes, so their digits keep a fixed width.
  count: { fontVariant: ['tabular-nums'], flexShrink: 1 },
  message: { fontFamily: monoFont },
});
