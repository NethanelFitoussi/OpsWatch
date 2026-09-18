/**
 * Infrastructure list and detail building blocks. The focus is health and anomalies, not a wall of metrics.
 */
import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { InfraDetail, InfraResource, Ref } from '@/api/contract';
import { useOpenRef } from '@/features/shared/navigation';
import { useI18n, type MessageKey } from '@/i18n';
import { HealthBadge } from '@/ui/badges';
import { ChipGroup, type ChipOption } from '@/ui/controls';
import { Card, Row, type IconName } from '@/ui/layout';
import { Text } from '@/ui/text';
import { radius, spacing, TOUCH_TARGET } from '@/ui/theme';
import { useTheme } from '@/ui/theme-provider';
import { CardList, CompactMetric } from '@/ui/data';
import { CATEGORY_ICONS, CATEGORY_LABELS, healthSummaryParts, type CategoryFilter } from './helpers';

export function CategoryChips({ categories, value, onChange }: { categories: CategoryFilter[]; value: CategoryFilter; onChange: (v: CategoryFilter) => void }) {
  const { t } = useI18n();
  const options: ChipOption<CategoryFilter>[] = categories.map((c) =>
    c === 'all' ? { value: c, label: t('filter.all') } : { value: c, label: t(CATEGORY_LABELS[c]), icon: CATEGORY_ICONS[c] },
  );
  return <ChipGroup options={options} value={value} onChange={onChange} accessibilityLabel={t('infrastructure.categoryFilter')} />;
}

/** "2 critical · 3 degraded · 3 healthy · 1 unknown" */
export function HealthSummary({ resources }: { resources: Pick<InfraResource, 'health'>[] }) {
  const { t } = useI18n();
  const parts = healthSummaryParts(resources);
  const text = parts.length
    ? parts.map((p) => t('infrastructure.summaryPart', { count: p.count, status: t(`health.${p.status}`).toLocaleLowerCase() })).join(' · ')
    : t('infrastructure.summaryEmpty');
  return (
    <View style={styles.inset}>
      <Text variant="small" weight="600" tone="muted" testID="infrastructure-summary" accessibilityLabel={`${t('infrastructure.summaryLabel')}: ${text}`}>
        {text}
      </Text>
    </View>
  );
}

export const InfraRow = memo(function InfraRow({ resource }: { resource: InfraResource }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const openRef = useOpenRef();
  const metrics = resource.keyMetrics.slice(0, 2);
  const anomalies = resource.anomalies.length;
  return (
    <Pressable
      onPress={() => openRef({ type: 'infrastructure', id: resource.id })}
      accessibilityRole="button"
      accessibilityLabel={[resource.name, t(`health.${resource.health}`), t(CATEGORY_LABELS[resource.category]), resource.summary, anomalies ? t('infrastructure.anomalies', { count: anomalies }) : null]
        .filter(Boolean)
        .join(', ')}
      testID={`infrastructure-row-${resource.id}`}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}
    >
      <Ionicons name={CATEGORY_ICONS[resource.category]} size={22} color={colors.textMuted} style={styles.icon} importantForAccessibility="no" />
      <View style={styles.body}>
        <View style={styles.top}>
          <Text variant="body" weight="600" numberOfLines={1} style={styles.flex}>
            {resource.name}
          </Text>
          <HealthBadge status={resource.health} />
        </View>
        {resource.summary ? (
          <Text variant="small" tone="muted" numberOfLines={2}>
            {resource.summary}
          </Text>
        ) : null}
        {metrics.length || anomalies ? (
          <View style={styles.metrics}>
            {metrics.map((m, i) => (
              <CompactMetric key={`${m.label}-${i}`} label={m.label} value={m.value} />
            ))}
            {anomalies ? (
              <View style={[styles.anomalies, { backgroundColor: colors.warningBg }]}>
                <Ionicons name="pulse" size={12} color={colors.warning} importantForAccessibility="no" />
                <Text variant="caption" weight="700" style={{ color: colors.warning }}>
                  {t('infrastructure.anomalies', { count: anomalies })}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} importantForAccessibility="no" />
    </Pressable>
  );
});

export function InfraHeader({ resource }: { resource: InfraDetail }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <Card>
      <View style={styles.header} testID="infrastructure-header">
        <HealthBadge status={resource.health} size="large" />
        <Text variant="title" accessibilityRole="header">
          {resource.name}
        </Text>
        <View style={styles.headerMeta}>
          <Ionicons name={CATEGORY_ICONS[resource.category]} size={16} color={colors.textMuted} importantForAccessibility="no" />
          <Text tone="muted">{t(CATEGORY_LABELS[resource.category])}</Text>
          {resource.status ? (
            <Text tone="muted" testID="infrastructure-provider-status">
              {`· ${t('infrastructure.providerStatus')}: ${resource.status}`}
            </Text>
          ) : null}
        </View>
        {resource.summary ? <Text>{resource.summary}</Text> : null}
      </View>
    </Card>
  );
}

export function AnomalyList({ anomalies }: { anomalies: string[] }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.anomalyCard, { backgroundColor: colors.warningBg, borderColor: colors.warning }]} testID="infrastructure-anomalies">
      {anomalies.map((a, i) => (
        <View key={`${a}-${i}`} style={styles.anomalyLine}>
          <Ionicons name="warning" size={16} color={colors.warning} importantForAccessibility="no" />
          <Text weight="600" style={[styles.flex, { color: colors.text }]}>
            {a}
          </Text>
        </View>
      ))}
    </View>
  );
}

const REF_ICONS: Partial<Record<Ref['type'], IconName>> = { service: 'apps-outline', infrastructure: 'server-outline', problem: 'alert-circle-outline', deployment: 'rocket-outline' };

export function RelatedList({ related }: { related: Ref[] }) {
  const { t } = useI18n();
  const openRef = useOpenRef();
  return (
    <CardList
      items={related}
      keyOf={(r) => `${r.type}:${r.id}`}
      render={(r) => (
        <Row
          testID={`infrastructure-related-${r.id}`}
          title={r.label ?? r.id}
          subtitle={t(`investigations.open.${r.type}` as MessageKey)}
          icon={REF_ICONS[r.type] ?? 'link-outline'}
          onPress={() => openRef(r)}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  inset: { paddingHorizontal: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: TOUCH_TARGET + 8, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
  icon: { width: 24, textAlign: 'center' },
  body: { flex: 1, gap: 4 },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.lg },
  anomalies: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  header: { gap: spacing.sm },
  headerMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  anomalyCard: { borderRadius: radius.md, borderWidth: 1, padding: spacing.md, gap: spacing.sm },
  anomalyLine: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
});
