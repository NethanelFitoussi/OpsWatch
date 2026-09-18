/**
 * Building blocks of Home and the Morning Brief. They answer, in order: is it healthy, do I need to act, what is the
 * most important problem, what changed.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { Change, Environment, Family, Health, HealthStatus, ProblemSummary } from '@/api/contract';
import { useI18n, type MessageKey } from '@/i18n';
import { HealthBadge, SeverityBadge, TONE_ICONS } from '@/ui/badges';
import { Button } from '@/ui/controls';
import { Card, Divider, Row, type IconName } from '@/ui/layout';
import { useNow, useRelativeTime } from '@/ui/states';
import { Text } from '@/ui/text';
import { radius, spacing, toneColors, toneForHealth } from '@/ui/theme';
import { useTheme } from '@/ui/theme-provider';
import { useOpenRef } from '../shared/navigation';

const STATUS_TITLE: Record<HealthStatus, MessageKey> = {
  healthy: 'home.status.healthy',
  degraded: 'home.status.degraded',
  critical: 'home.status.critical',
  unknown: 'home.status.unknown',
};

/** "Do I need to act?" derived from counts only, so it is the same everywhere. */
export function actionVerdict(counts: Health['counts']): { key: MessageKey; params?: Record<string, number> } {
  if (counts.critical > 0) return { key: 'home.needAction.yes', params: { count: counts.critical } };
  if (counts.warning > 0) return { key: 'home.needAction.maybe' };
  return { key: 'home.needAction.no' };
}

export function StatusHero({ health, environment }: { health: Pick<Health, 'status' | 'headline' | 'counts'>; environment: Environment | null }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const tone = toneForHealth(health.status);
  const { fg, bg } = toneColors(colors, tone);
  const verdict = actionVerdict(health.counts);
  const envName = environment?.name ?? t('env.production');
  return (
    <View style={[styles.hero, { backgroundColor: bg, borderColor: fg }]} testID="status-hero" accessible accessibilityRole="summary">
      <Text variant="small" weight="600" style={{ color: fg }}>
        {t('home.question', { environment: envName })}
      </Text>
      <View style={styles.heroRow}>
        <Ionicons name={TONE_ICONS[tone]} size={30} color={fg} importantForAccessibility="no" />
        <Text variant="headline" style={{ color: colors.text, flex: 1 }} testID="status-title">
          {t(STATUS_TITLE[health.status])}
        </Text>
      </View>
      {health.headline ? <Text style={{ color: colors.text }}>{health.headline}</Text> : null}
      <View style={[styles.verdict, { borderTopColor: fg }]}>
        <Text variant="small" weight="700" style={{ color: fg }}>
          {t('home.needAction')}
        </Text>
        <Text variant="small" style={{ color: colors.text }} testID="action-verdict">
          {t(verdict.key, verdict.params)}
        </Text>
      </View>
    </View>
  );
}

export function CountsRow({ counts }: { counts: Health['counts'] }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  // "15" over "of 18 healthy services": a short value never truncates on small phones.
  const healthyValue = counts.healthyServices === null ? t('state.noData') : String(counts.healthyServices);
  const healthyLabel = counts.healthyServices !== null && counts.totalServices !== null ? t('home.count.healthyOfTotal', { total: counts.totalServices }) : t('home.count.healthyServices');
  const items: { value: string; label: string; icon: IconName; color: string; testID: string }[] = [
    { value: String(counts.critical), label: t('home.count.critical'), icon: 'alert-circle', color: counts.critical ? colors.critical : colors.textFaint, testID: 'count-critical' },
    { value: String(counts.warning), label: t('home.count.warning'), icon: 'warning', color: counts.warning ? colors.warning : colors.textFaint, testID: 'count-warning' },
    { value: healthyValue, label: healthyLabel, icon: 'checkmark-circle', color: colors.healthy, testID: 'count-healthy' },
  ];
  return (
    <View style={styles.counts}>
      {items.map((item) => (
        <View key={item.testID} style={[styles.count, { backgroundColor: colors.surface, borderColor: colors.border }]} accessible accessibilityLabel={`${item.value} ${item.label}`} testID={item.testID}>
          <Ionicons name={item.icon} size={18} color={item.color} importantForAccessibility="no" />
          <Text variant="title" numberOfLines={1} adjustsFontSizeToFit>
            {item.value}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function MostImportantProblem({ problem, title }: { problem: ProblemSummary | null; title: string }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const openRef = useOpenRef();
  const now = useNow();
  const relative = useRelativeTime();
  if (!problem) {
    return (
      <Card accent={colors.healthy}>
        <Text variant="label" tone="muted">
          {title.toUpperCase()}
        </Text>
        <Text style={{ marginTop: spacing.sm }}>{t('home.noProblem')}</Text>
      </Card>
    );
  }
  const accent = problem.severity === 'critical' ? colors.critical : problem.severity === 'warning' ? colors.warning : colors.info;
  return (
    <Card accent={accent}>
      <View style={{ gap: spacing.sm }} testID="most-important-problem">
        <Text variant="label" tone="muted" accessibilityRole="header">
          {title.toUpperCase()}
        </Text>
        <SeverityBadge severity={problem.severity} />
        <Text variant="subtitle">{problem.title}</Text>
        {problem.summary ? <Text tone="muted">{problem.summary}</Text> : null}
        <Text variant="small" tone="faint">
          {[problem.service?.label, `${t('time.since', { time: relative(problem.firstSeenAt, now) })}`].filter(Boolean).join(' · ')}
        </Text>
        <Button label={t('action.investigate')} icon="search" onPress={() => openRef({ type: 'problem', id: problem.id })} testID="investigate-top-problem" />
      </View>
    </Card>
  );
}

const CHANGE_ICONS: Record<Change['direction'], IconName> = {
  up: 'trending-up',
  down: 'trending-down',
  new: 'sparkles',
  resolved: 'checkmark-done',
  stable: 'remove',
};

export function ChangesList({ changes, emptyLabel }: { changes: Change[]; emptyLabel: string }) {
  const { colors } = useTheme();
  const openRef = useOpenRef();
  if (!changes.length) return <Text tone="muted">{emptyLabel}</Text>;
  return (
    <Card padded={false}>
      {changes.map((change, i) => {
        const color = change.severity === 'critical' ? colors.critical : change.severity === 'warning' ? colors.warning : change.direction === 'resolved' ? colors.healthy : colors.textMuted;
        return (
          <View key={change.id}>
            {i > 0 ? <Divider /> : null}
            <Row
              testID={`change-${change.id}`}
              title={change.text}
              icon={CHANGE_ICONS[change.direction]}
              iconColor={color}
              numberOfLines={3}
              onPress={change.ref ? () => openRef(change.ref!) : undefined}
            />
          </View>
        );
      })}
    </Card>
  );
}

const FAMILY_ICONS: Record<string, IconName> = {
  ecs: 'cube-outline',
  rds: 'server-outline',
  alb: 'git-network-outline',
  alarms: 'notifications-outline',
  redis: 'flash-outline',
  synthetics: 'globe-outline',
  errors: 'bug-outline',
};

export function CoverageList({ families }: { families: Family[] }) {
  const { t } = useI18n();
  return (
    <Card padded={false}>
      {families.map((family, i) => (
        <View key={family.family}>
          {i > 0 ? <Divider /> : null}
          <Row
            title={family.label}
            icon={FAMILY_ICONS[family.family] ?? 'ellipse-outline'}
            subtitle={
              family.unavailable
                ? t('home.coverage.unavailable', { reason: family.unavailable.code ?? family.unavailable.reason })
                : family.total === null || family.affected === null
                  ? t('state.noData')
                  : family.affected === 0
                    ? t('home.coverage.none')
                    : t('home.coverage.affected', { affected: family.affected, total: family.total })
            }
            right={<HealthBadge status={family.status} />}
            testID={`family-${family.family}`}
          />
        </View>
      ))}
    </Card>
  );
}

export function SyntheticsStrip({ synthetics }: { synthetics: NonNullable<Health['synthetics']> }) {
  const { t } = useI18n();
  const router = useRouter();
  const status: HealthStatus = synthetics.down > 0 ? 'critical' : synthetics.degraded > 0 ? 'degraded' : 'healthy';
  return (
    <Card padded={false}>
      <Row
        title={t('home.synthetics')}
        subtitle={t('home.syntheticsSummary', synthetics)}
        icon="globe-outline"
        right={<HealthBadge status={status} />}
        onPress={() => router.push('/synthetics')}
        testID="synthetics-strip"
      />
    </Card>
  );
}

export function GeneratedAt({ at, now }: { at: number; now: number }) {
  const { t } = useI18n();
  const relative = useRelativeTime();
  return (
    <Text variant="caption" tone="faint">
      {t('brief.period', { time: relative(at, now) })}
    </Text>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg, gap: spacing.sm },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  verdict: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm, marginTop: spacing.xs, gap: 2 },
  counts: { flexDirection: 'row', gap: spacing.sm },
  count: { flex: 1, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, gap: 2, minHeight: 96 },
});
