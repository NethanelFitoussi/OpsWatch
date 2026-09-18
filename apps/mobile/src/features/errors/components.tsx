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
import { errorStatusIcon, errorStatusLabelKey, errorStatusTone, formatCount, type ErrorStatus } from './helpers';

export function ErrorStatusBadge({ status, size }: { status: ErrorStatus; size?: 'small' | 'large' }) {
  const { t } = useI18n();
  return <Badge tone={errorStatusTone(status)} icon={errorStatusIcon(status)} label={t(errorStatusLabelKey(status))} size={size} testID={`error-status-${status}`} />;
}

/** "Occurrences: 2.4k" or "Occurrences: No data": a missing count is never shown as 0. */
export function useCountLabel() {
  const { t } = useI18n();
  return (label: string, value: number | null) => `${label}: ${formatCount(value) ?? t('metric.noData')}`;
}

export const ErrorRow = memo(function ErrorRow({ error }: { error: ErrorSummary }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const openRef = useOpenRef();
  const now = useNow();
  const relative = useRelativeTime();
  const countLabel = useCountLabel();
  const context = [error.type, error.service?.label ?? error.service?.id, error.route].filter(Boolean).join(' · ');
  const meta = [
    countLabel(t('metric.occurrences'), error.occurrences),
    countLabel(t('errors.instances'), error.affectedInstances),
    `${t('time.lastSeen')} ${relative(error.lastSeenAt, now)}`,
  ].join(' · ');
  const status = t(errorStatusLabelKey(error.status));
  return (
    <Pressable
      onPress={() => openRef({ type: 'error', id: error.id })}
      accessibilityRole="button"
      accessibilityLabel={`${status}, ${error.message}, ${context}, ${meta}`}
      testID={`errors-row-${error.id}`}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}
    >
      <View style={styles.body}>
        <ErrorStatusBadge status={error.status} />
        <Text variant="small" weight="600" style={styles.message} numberOfLines={2}>
          {error.message}
        </Text>
        {context ? (
          <Text variant="small" tone="muted" numberOfLines={1}>
            {context}
          </Text>
        ) : null}
        <Text variant="caption" tone="faint" numberOfLines={2}>
          {meta}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} importantForAccessibility="no" />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: TOUCH_TARGET + 8 },
  body: { flex: 1, gap: 4 },
  message: { fontFamily: monoFont },
});
