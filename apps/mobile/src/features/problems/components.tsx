/**
 * Problems list building blocks: the status badge, the list row and the filter header.
 */
import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { ProblemStatus, ProblemSummary, Severity } from '@/api/contract';
import { useOpenRef } from '@/features/shared/navigation';
import { useI18n } from '@/i18n';
import { Badge, SeverityBadge } from '@/ui/badges';
import { Chip, ChipGroup, MultiChipGroup, type ChipOption } from '@/ui/controls';
import { useNow, useRelativeTime } from '@/ui/states';
import { Text } from '@/ui/text';
import { spacing, TOUCH_TARGET } from '@/ui/theme';
import { useTheme } from '@/ui/theme-provider';
import {
  CATEGORY_ALL,
  categoryFromValue,
  categoryValue,
  occurrencesText,
  STATUS_FILTERS,
  STATUS_META,
  TIME_RANGES,
  TREND_ICONS,
  type StatusFilter,
  type TimeRange,
} from './helpers';

export function ProblemStatusBadge({ status, testID }: { status: ProblemStatus; testID?: string }) {
  const { t } = useI18n();
  const meta = STATUS_META[status];
  return <Badge tone={meta.tone} icon={meta.icon} label={t(`status.${status}`)} testID={testID} />;
}

export function TrendIndicator({ trend }: { trend: ProblemSummary['trend'] }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  if (!trend) return null;
  const color = trend === 'rising' ? colors.critical : trend === 'falling' ? colors.healthy : colors.textMuted;
  return (
    <View style={styles.trend} accessible accessibilityLabel={`${t('problems.trend')}: ${t(`trend.${trend}`)}`}>
      <Ionicons name={TREND_ICONS[trend]} size={14} color={color} importantForAccessibility="no" />
      <Text variant="caption" tone="muted">
        {t(`trend.${trend}`)}
      </Text>
    </View>
  );
}

/** Severity, status and trend first, then the title, then where and how often. */
export const ProblemListRow = memo(function ProblemListRow({ problem }: { problem: ProblemSummary }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const openRef = useOpenRef();
  const now = useNow();
  const relative = useRelativeTime();
  const meta = [problem.service?.label ?? problem.service?.id, t('problems.row.lastSeen', { time: relative(problem.lastSeenAt, now) }), occurrencesText(t, problem.occurrences)]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      onPress={() => openRef({ type: 'problem', id: problem.id })}
      accessibilityRole="button"
      accessibilityLabel={`${t(`severity.${problem.severity}`)}, ${t(`status.${problem.status}`)}, ${problem.title}, ${meta}`}
      testID={`problems-row-${problem.id}`}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}
    >
      <View style={styles.rowBody}>
        <View style={styles.badges}>
          <SeverityBadge severity={problem.severity} />
          <ProblemStatusBadge status={problem.status} />
          <TrendIndicator trend={problem.trend} />
        </View>
        <Text variant="body" weight="600" numberOfLines={2}>
          {problem.title}
        </Text>
        <Text variant="small" tone="muted" numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} importantForAccessibility="no" />
    </Pressable>
  );
});

type FilterHeaderProps = {
  status: StatusFilter;
  onStatus: (status: StatusFilter) => void;
  severities: Severity[];
  onSeverities: (severities: Severity[]) => void;
  categories: string[];
  category: string | null;
  onCategory: (category: string | null) => void;
  range: TimeRange;
  onRange: (range: TimeRange) => void;
  service: { id: string; label: string } | null;
  onClearService: () => void;
};

export function ProblemFilterHeader(props: FilterHeaderProps) {
  const { t } = useI18n();
  const statusOptions: ChipOption<StatusFilter>[] = STATUS_FILTERS.map((value) => ({ value, label: value === 'all' ? t('filter.all') : t(`status.${value}`) }));
  const severityOptions: ChipOption<Severity>[] = (['critical', 'warning', 'info'] as const).map((value) => ({ value, label: t(`severity.${value}`) }));
  const categoryOptions: ChipOption<string>[] = [{ value: CATEGORY_ALL, label: t('filter.all') }, ...props.categories.map((c) => ({ value: categoryValue(c), label: c }))];
  const timeOptions: ChipOption<TimeRange>[] = TIME_RANGES.map((value) => ({ value, label: t(`time.range.${value}`), icon: value === 'any' ? undefined : 'time-outline' }));
  return (
    <View style={styles.filters} testID="problems-filters">
      {props.service ? (
        <View style={styles.inset}>
          <Chip label={t('problems.serviceFilter', { service: props.service.label })} selected onPress={props.onClearService} testID="problems-service-filter" />
        </View>
      ) : null}
      <ChipGroup options={statusOptions} value={props.status} onChange={props.onStatus} accessibilityLabel={t('filter.status')} />
      <MultiChipGroup options={severityOptions} values={props.severities} onChange={props.onSeverities} accessibilityLabel={t('filter.severity')} />
      {props.categories.length > 0 ? (
        <ChipGroup
          options={categoryOptions}
          value={props.category ? categoryValue(props.category) : CATEGORY_ALL}
          onChange={(value) => props.onCategory(categoryFromValue(value))}
          accessibilityLabel={t('filter.category')}
        />
      ) : null}
      <ChipGroup options={timeOptions} value={props.range} onChange={props.onRange} accessibilityLabel={t('filter.time')} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: TOUCH_TARGET + 8, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  rowBody: { flex: 1, gap: 4 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  trend: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  filters: { gap: spacing.xs },
  inset: { paddingHorizontal: spacing.lg, flexDirection: 'row' },
});
