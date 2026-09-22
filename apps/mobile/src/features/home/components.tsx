/**
 * Building blocks of Home and the Morning Brief. They answer, in order: is it healthy, do I need to act, what is the
 * most important problem, what changed.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Fragment } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Change, Environment, Family, Health, HealthStatus, ProblemSummary } from '@/api/contract';
import { durationText, occurrencesText } from '@/features/problems/helpers';
import { useI18n, type MessageKey } from '@/i18n';
import { HealthBadge, SeverityBadge, TONE_ICONS } from '@/ui/badges';
import { Button } from '@/ui/controls';
import { Card, Divider, Row, type IconName } from '@/ui/layout';
import { useNow, useRelativeTime } from '@/ui/states';
import { Text } from '@/ui/text';
import { radius, spacing, toneColors, toneForHealth } from '@/ui/theme';
import { useTheme } from '@/ui/theme-provider';
import { useOpenRef } from '../shared/navigation';
import { actionVerdict, familyStatus, groupChanges, unavailableReason, unreadableFamilies } from './helpers';

const STATUS_TITLE: Record<HealthStatus, MessageKey> = {
  healthy: 'home.status.healthy',
  degraded: 'home.status.degraded',
  critical: 'home.status.critical',
  unknown: 'home.status.unknown',
};

type HeroHealth = Pick<Health, 'status' | 'headline' | 'counts' | 'families' | 'generatedAt'>;

/**
 * The first thing on Home: is production healthy, must I act, and how much of the picture OpsWatch actually has.
 * `generatedAt` is the server's own snapshot time, which is older than the moment the app fetched it.
 */
export function StatusHero({ health, environment }: { health: HeroHealth; environment: Environment | null }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const now = useNow();
  const relative = useRelativeTime();
  const tone = toneForHealth(health.status);
  const { fg, bg } = toneColors(colors, tone);
  const verdict = actionVerdict(health.counts);
  const envName = environment?.name ?? t('env.production');
  const unreadable = unreadableFamilies(health.families);
  const caveat = unreadable.length ? t('home.partial', { families: unreadable.map((family) => family.label).join(', ') }) : null;
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
        {caveat ? (
          <View style={styles.caveat} testID="coverage-caveat">
            <Ionicons name="alert-circle-outline" size={14} color={colors.warning} importantForAccessibility="no" />
            <Text variant="caption" style={{ color: colors.warning, flex: 1 }}>
              {caveat}
            </Text>
          </View>
        ) : null}
        <Text variant="caption" tone="faint" testID="health-generated-at">
          {t('home.checkedAt', { time: relative(health.generatedAt, now) })}
        </Text>
      </View>
    </View>
  );
}

type CountItem = { value: string; label: string; icon: IconName; color: string; testID: string; onPress?: () => void };

export function CountsRow({ counts }: { counts: Health['counts'] }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  // "15" over "of 18 healthy services": a short value never truncates on small phones.
  const healthyValue = counts.healthyServices === null ? t('state.noData') : String(counts.healthyServices);
  const healthyLabel = counts.healthyServices !== null && counts.totalServices !== null ? t('home.count.healthyOfTotal', { total: counts.totalServices }) : t('home.count.healthyServices');
  // The two tiles that mean "act" open the matching problems; the healthy tile has nothing to open.
  const items: CountItem[] = [
    {
      value: String(counts.critical),
      label: t('home.count.critical'),
      icon: 'alert-circle',
      color: counts.critical ? colors.critical : colors.textFaint,
      testID: 'count-critical',
      onPress: counts.critical ? () => router.push('/problems?severity=critical') : undefined,
    },
    {
      value: String(counts.warning),
      label: t('home.count.warning'),
      icon: 'warning',
      color: counts.warning ? colors.warning : colors.textFaint,
      testID: 'count-warning',
      onPress: counts.warning ? () => router.push('/problems?severity=warning') : undefined,
    },
    { value: healthyValue, label: healthyLabel, icon: 'checkmark-circle', color: colors.healthy, testID: 'count-healthy' },
  ];
  return (
    <View style={styles.counts}>
      {items.map((item) => {
        const body = (
          <>
            <Ionicons name={item.icon} size={18} color={item.color} importantForAccessibility="no" />
            <Text variant="title" numberOfLines={1} adjustsFontSizeToFit style={styles.tabular}>
              {item.value}
            </Text>
            {/* No line cap: at a large font scale "of 18 healthy services" needs three lines, and a truncated
                count tile is the one thing on this screen that must never be ambiguous. The tiles share a row, so
                they grow together and stay aligned. */}
            <Text variant="caption" tone="muted">
              {item.label}
            </Text>
          </>
        );
        const style = [styles.count, { backgroundColor: colors.surface, borderColor: colors.border }];
        return item.onPress ? (
          <Pressable
            key={item.testID}
            onPress={item.onPress}
            accessibilityRole="button"
            accessibilityLabel={`${item.value} ${item.label}`}
            accessibilityHint={t('home.count.hint')}
            testID={item.testID}
            style={({ pressed }) => [style, pressed && { backgroundColor: colors.surfaceAlt }]}
          >
            {body}
          </Pressable>
        ) : (
          <View key={item.testID} style={style} accessible accessibilityLabel={`${item.value} ${item.label}`} testID={item.testID}>
            {body}
          </View>
        );
      })}
    </View>
  );
}

export function MostImportantProblem({ problem, title }: { problem: ProblemSummary | null; title: string }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const openRef = useOpenRef();
  const now = useNow();
  if (!problem) {
    return (
      <Card accent={colors.healthy} testID="most-important-none">
        <Text variant="label" tone="muted" accessibilityRole="header">
          {title.toUpperCase()}
        </Text>
        <Text style={{ marginTop: spacing.sm }}>{t('home.noProblem')}</Text>
      </Card>
    );
  }
  const accent = problem.severity === 'critical' ? colors.critical : problem.severity === 'warning' ? colors.warning : colors.info;
  // How long it has been going is the fact that decides whether to act; "since 3 h ago" would read as an instant, not a length.
  const meta = [problem.service?.label ?? problem.service?.id, durationText(t, problem, now), occurrencesText(t, problem.occurrences)].filter(Boolean).join(' · ');
  return (
    <Card accent={accent}>
      <View style={{ gap: spacing.sm }} testID="most-important-problem">
        <Text variant="label" tone="muted" accessibilityRole="header">
          {title.toUpperCase()}
        </Text>
        <SeverityBadge severity={problem.severity} />
        <Text variant="subtitle">{problem.title}</Text>
        {problem.summary ? <Text tone="muted">{problem.summary}</Text> : null}
        <Text variant="small" tone="faint" style={styles.tabular}>
          {meta}
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

function ChangeRow({ change }: { change: Change }) {
  const { colors } = useTheme();
  const openRef = useOpenRef();
  const color =
    change.severity === 'critical' ? colors.critical : change.severity === 'warning' ? colors.warning : change.direction === 'resolved' ? colors.healthy : colors.textMuted;
  return (
    <Row
      testID={`change-${change.id}`}
      title={change.text}
      icon={CHANGE_ICONS[change.direction]}
      iconColor={color}
      numberOfLines={3}
      onPress={change.ref ? () => openRef(change.ref!) : undefined}
    />
  );
}

/** The flat list Home uses: every change in the order the server sent them. */
export function ChangesList({ changes, emptyLabel }: { changes: Change[]; emptyLabel: string }) {
  if (!changes.length) return <Text tone="muted">{emptyLabel}</Text>;
  return (
    <Card padded={false}>
      {changes.map((change, i) => (
        <View key={change.id}>
          {i > 0 ? <Divider /> : null}
          <ChangeRow change={change} />
        </View>
      ))}
    </Card>
  );
}

/**
 * The briefing version: the same changes under a heading per movement (new, increased, decreased, resolved,
 * unchanged), so "what is new" and "what closed" are not read one after the other.
 */
export function ChangeDigest({ changes, emptyLabel }: { changes: Change[]; emptyLabel: string }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const groups = groupChanges(changes);
  if (!groups.length) return <Text tone="muted">{emptyLabel}</Text>;
  return (
    <Card padded={false} testID="change-digest">
      {groups.map((group, groupIndex) => (
        <Fragment key={group.direction}>
          {groupIndex > 0 ? <Divider /> : null}
          <View style={[styles.groupHeader, { backgroundColor: colors.surfaceAlt }]}>
            <Text variant="label" tone="muted" accessibilityRole="header" testID={`change-group-${group.direction}`}>
              {`${t(group.title).toUpperCase()} · ${group.changes.length}`}
            </Text>
          </View>
          {group.changes.map((change, i) => (
            <View key={change.id}>
              {i > 0 ? <Divider /> : null}
              <ChangeRow change={change} />
            </View>
          ))}
        </Fragment>
      ))}
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

/** What OpsWatch actually looked at. A family it could not read is shown as unknown, never as healthy. */
export function CoverageList({ families }: { families: Family[] }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <Card padded={false}>
      {families.map((family, i) => (
        <View key={family.family}>
          {i > 0 ? <Divider /> : null}
          <Row
            title={family.label}
            icon={family.unavailable ? 'help-circle-outline' : (FAMILY_ICONS[family.family] ?? 'ellipse-outline')}
            iconColor={family.unavailable ? colors.warning : undefined}
            subtitle={
              family.unavailable
                ? t('home.coverage.unavailable', { reason: unavailableReason(family.unavailable) })
                : family.total === null || family.affected === null
                  ? t('state.noData')
                  : family.affected === 0
                    ? t('home.coverage.none')
                    : t('home.coverage.affected', { affected: family.affected, total: family.total })
            }
            right={<HealthBadge status={familyStatus(family)} />}
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

/** When the server put the briefing together. The period it covers is stated in the headline, from the server's data. */
export function GeneratedAt({ at, now }: { at: number; now: number }) {
  const { t } = useI18n();
  const relative = useRelativeTime();
  return (
    <Text variant="caption" tone="faint" testID="brief-generated-at">
      {t('brief.generated', { time: relative(at, now) })}
    </Text>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg, gap: spacing.sm },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  verdict: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm, marginTop: spacing.xs, gap: 2 },
  caveat: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, marginTop: 2 },
  counts: { flexDirection: 'row', gap: spacing.sm },
  count: { flex: 1, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, gap: 2, minHeight: 96, justifyContent: 'flex-start' },
  groupHeader: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, minHeight: 28, justifyContent: 'center' },
  tabular: { fontVariant: ['tabular-nums'] },
});
