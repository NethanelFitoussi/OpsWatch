/**
 * Services list and detail building blocks.
 */
import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { AlertSummary, HealthStatus, ServiceDetail, ServiceSummary } from '@/api/contract';
import { FavoriteButton } from '@/features/shared/components';
import { useOpenRef } from '@/features/shared/navigation';
import { useI18n, type MessageKey, type Translate } from '@/i18n';
import { HealthBadge, SeverityBadge } from '@/ui/badges';
import { ChipGroup, TextField, type ChipOption } from '@/ui/controls';
import { Card, Row } from '@/ui/layout';
import { useNow, useRelativeTime } from '@/ui/states';
import { Text } from '@/ui/text';
import { spacing, TOUCH_TARGET } from '@/ui/theme';
import { useTheme } from '@/ui/theme-provider';
import { HEALTH_FILTERS, type HealthFilter } from './helpers';
import { CompactMetric } from './parts';

/** Open problems and firing alerts, only the counts the server knows (null is left out, not shown as 0). */
export function serviceCounts(service: Pick<ServiceSummary, 'openProblems' | 'firingAlerts'>, t: Translate): string[] {
  const parts: string[] = [];
  if (service.openProblems !== null) parts.push(t('services.openProblems', { count: service.openProblems }));
  if (service.firingAlerts !== null) parts.push(t('services.firingAlerts', { count: service.firingAlerts }));
  return parts;
}

export const ServiceRow = memo(function ServiceRow({ service, favorite }: { service: ServiceSummary; favorite: boolean }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const openRef = useOpenRef();
  const counts = serviceCounts(service, t);
  return (
    <Pressable
      onPress={() => openRef({ type: 'service', id: service.id })}
      accessibilityRole="button"
      accessibilityLabel={[service.name, t(`health.${service.health}`), favorite ? t('services.favorite') : null, ...counts].filter(Boolean).join(', ')}
      testID={`service-row-${service.id}`}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}
    >
      <View style={styles.rowTop}>
        <HealthBadge status={service.health} />
        <Text variant="body" weight="600" numberOfLines={1} style={styles.flex}>
          {service.name}
        </Text>
        {favorite ? <Ionicons name="star" size={16} color={colors.warning} testID={`service-favorite-${service.id}`} accessibilityLabel={t('services.favorite')} /> : null}
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} importantForAccessibility="no" />
      </View>
      {service.kind || counts.length ? (
        <Text variant="small" tone="muted" numberOfLines={1}>
          {[service.kind, ...counts].filter(Boolean).join(' · ')}
        </Text>
      ) : null}
      <View style={styles.metrics}>
        <CompactMetric label={t('services.metric.errors')} value={service.errorRate} testID={`service-${service.id}-errorRate`} />
        <CompactMetric label={t('services.metric.p95')} value={service.latencyP95} testID={`service-${service.id}-latencyP95`} />
        <CompactMetric label={t('services.metric.requests')} value={service.requests} testID={`service-${service.id}-requests`} />
      </View>
    </Pressable>
  );
});

export function ServiceFilters({ text, onText, health, onHealth }: { text: string; onText: (v: string) => void; health: HealthFilter; onHealth: (v: HealthFilter) => void }) {
  const { t } = useI18n();
  const options: ChipOption<HealthFilter>[] = HEALTH_FILTERS.map((value) => ({ value, label: value === 'all' ? t('filter.all') : t(`health.${value}` as `health.${HealthStatus}`) }));
  return (
    <View style={styles.filters}>
      <View style={styles.inset}>
        <TextField
          label={t('services.search')}
          placeholder={t('services.searchPlaceholder')}
          value={text}
          onChangeText={onText}
          icon="search"
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
          testID="services-search"
        />
      </View>
      <ChipGroup options={options} value={health} onChange={onHealth} accessibilityLabel={t('services.healthFilter')} />
    </View>
  );
}

export function ServiceHeader({ service }: { service: ServiceDetail }) {
  const { t } = useI18n();
  const counts = serviceCounts(service, t);
  return (
    <Card>
      <View style={styles.header} testID="service-header">
        <View style={styles.headerTop}>
          <HealthBadge status={service.health} size="large" />
          <View style={styles.flex} />
          <FavoriteButton favorite={{ type: 'service', id: service.id, label: service.name }} />
        </View>
        <Text variant="title" accessibilityRole="header">
          {service.name}
        </Text>
        {service.kind ? <Text tone="muted">{service.kind}</Text> : null}
        {service.description ? <Text>{service.description}</Text> : null}
        {counts.length ? (
          <Text variant="small" weight="600" tone="muted">
            {counts.join(' · ')}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

const ALERT_STATUS: Record<AlertSummary['status'], MessageKey> = {
  firing: 'services.alertStatus.firing',
  acknowledged: 'services.alertStatus.acknowledged',
  resolved: 'services.alertStatus.resolved',
  insufficient_data: 'services.alertStatus.insufficient_data',
};

export function AlertLine({ alert }: { alert: AlertSummary }) {
  const { t } = useI18n();
  const openRef = useOpenRef();
  const now = useNow();
  const relative = useRelativeTime();
  return (
    <Row
      testID={`service-alert-${alert.id}`}
      title={alert.name}
      subtitle={[t(ALERT_STATUS[alert.status]), alert.since !== null ? relative(alert.since, now) : null, alert.reason].filter(Boolean).join(' · ')}
      left={<SeverityBadge severity={alert.severity} />}
      onPress={() => openRef({ type: 'alert', id: alert.id })}
    />
  );
}

const styles = StyleSheet.create({
  row: { minHeight: TOUCH_TARGET + 8, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: 6 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  metrics: { flexDirection: 'row', gap: spacing.lg },
  filters: { gap: spacing.sm },
  inset: { paddingHorizontal: spacing.lg },
  header: { gap: spacing.sm },
  headerTop: { flexDirection: 'row', alignItems: 'center' },
});
