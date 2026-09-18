/**
 * Domain components shared by several features.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { memo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Evidence, EvidenceKind, Favorite, MetricValue, ProblemSummary, Ref } from '@/api/contract';
import { useSaveFavorites, useServerFavorites } from '@/api/queries';
import { useI18n, type MessageKey } from '@/i18n';
import { formatClock, formatMetric } from '@/lib/format';
import { useFeature } from '@/state/session';
import { useSettings } from '@/state/settings';
import { SeverityBadge, StateBadge } from '@/ui/badges';
import { TrendChart } from '@/ui/charts';
import { Button } from '@/ui/controls';
import { Card, Row, type IconName } from '@/ui/layout';
import { useNow, useRelativeTime } from '@/ui/states';
import { Text } from '@/ui/text';
import { radius, spacing } from '@/ui/theme';
import { useTheme } from '@/ui/theme-provider';
import { useOpenRef } from './navigation';

export const ProblemRow = memo(function ProblemRow({ problem, onPress }: { problem: ProblemSummary; onPress?: () => void }) {
  const { t } = useI18n();
  const openRef = useOpenRef();
  const now = useNow();
  const relative = useRelativeTime();
  const statusLabel = t(`status.${problem.status}` as MessageKey);
  return (
    <Row
      testID={`problem-${problem.id}`}
      title={problem.title}
      subtitle={[problem.service?.label, `${statusLabel} · ${relative(problem.lastSeenAt, now)}`].filter(Boolean).join(' · ')}
      left={<SeverityBadge severity={problem.severity} />}
      onPress={onPress ?? (() => openRef({ type: 'problem', id: problem.id }))}
      accessibilityLabel={`${t(`severity.${problem.severity}`)}, ${problem.title}, ${statusLabel}`}
    />
  );
});

export function MetricTile({ label, value, testID }: { label: string; value: MetricValue; testID?: string }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const noData = value.value === null;
  const tone = value.status === 'critical' ? colors.critical : value.status === 'warning' ? colors.warning : colors.text;
  return (
    <View style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }]} accessible accessibilityLabel={`${label}: ${noData ? t('metric.noData') : formatMetric(value.value, value.unit)}`} testID={testID}>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {label}
      </Text>
      <Text variant={noData ? 'small' : 'subtitle'} weight="700" style={{ color: noData ? colors.textFaint : tone }} numberOfLines={1} adjustsFontSizeToFit>
        {noData ? t('metric.noData') : formatMetric(value.value, value.unit)}
      </Text>
      {value.status === 'critical' || value.status === 'warning' ? (
        <Text variant="caption" style={{ color: tone }}>
          {t(`severity.${value.status}`)}
        </Text>
      ) : null}
    </View>
  );
}

export function TileGrid({ children }: { children: ReactNode }) {
  return <View style={styles.tiles}>{children}</View>;
}

const EVIDENCE_META: Record<EvidenceKind, { icon: IconName; title: MessageKey }> = {
  fact: { icon: 'eye-outline', title: 'investigations.facts' },
  correlation: { icon: 'git-compare-outline', title: 'investigations.correlations' },
  hypothesis: { icon: 'bulb-outline', title: 'investigations.hypotheses' },
};

/** One evidence item: time, title, detail, optional mini chart and a link to the object it points at. */
export const EvidenceItem = memo(function EvidenceItem({ item, locale }: { item: Evidence; locale: string }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const openRef = useOpenRef();
  const [expanded, setExpanded] = useState(false);
  const meta = EVIDENCE_META[item.kind];
  const canExpand = !!item.series || !!item.detail;
  return (
    <View style={styles.evidence} testID={`evidence-${item.id}`}>
      <View style={styles.evidenceTime}>
        <Text variant="small" weight="700" style={{ fontVariant: ['tabular-nums'] }}>
          {formatClock(item.at, locale)}
        </Text>
        <View style={[styles.evidenceLine, { backgroundColor: colors.border }]} />
      </View>
      <View style={[styles.evidenceBody, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Pressable
          onPress={canExpand ? () => setExpanded(!expanded) : undefined}
          disabled={!canExpand}
          accessibilityRole={canExpand ? 'button' : 'text'}
          accessibilityState={canExpand ? { expanded } : undefined}
          style={styles.evidenceHead}
        >
          <Ionicons name={meta.icon} size={16} color={colors.textMuted} importantForAccessibility="no" />
          <Text variant="body" weight="600" style={{ flex: 1 }}>
            {item.title}
          </Text>
          {item.confidence ? (
            <Text variant="caption" tone="muted">
              {t(`investigations.confidence.${item.confidence}`)}
            </Text>
          ) : null}
        </Pressable>
        {expanded && item.detail ? <Text tone="muted">{item.detail}</Text> : null}
        {expanded && item.series ? <TrendChart series={item.series} height={110} /> : null}
        {item.ref ? (
          <Pressable onPress={() => openRef(item.ref!)} accessibilityRole="link" style={styles.evidenceLink}>
            <Text variant="small" weight="600" tone="primary">
              {item.ref.label ?? t(`investigations.open.${item.ref.type}`)}
            </Text>
            <Ionicons name="arrow-forward" size={14} color={colors.primary} importantForAccessibility="no" />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
});

/**
 * Evidence grouped into three visibly separate sections: observed facts, correlations and hypotheses. Each section is
 * chronological. Hypotheses are never mixed with facts.
 */
export function EvidenceSections({ evidence, locale }: { evidence: Evidence[]; locale: string }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const kinds: EvidenceKind[] = ['fact', 'correlation', 'hypothesis'];
  return (
    <View style={{ gap: spacing.lg }}>
      {kinds.map((kind) => {
        const items = evidence.filter((e) => e.kind === kind).sort((a, b) => a.at - b.at);
        if (!items.length) return null;
        const meta = EVIDENCE_META[kind];
        return (
          <View key={kind} style={{ gap: spacing.sm }} testID={`evidence-section-${kind}`}>
            <View style={styles.sectionTitle}>
              <Ionicons name={meta.icon} size={16} color={kind === 'hypothesis' ? colors.warning : colors.textMuted} importantForAccessibility="no" />
              <Text variant="label" tone="muted" accessibilityRole="header">
                {t(meta.title).toUpperCase()}
              </Text>
            </View>
            {kind === 'hypothesis' ? (
              <Text variant="small" tone="muted">
                {t('investigations.hypothesisNote')}
              </Text>
            ) : null}
            {items.map((item) => (
              <EvidenceItem key={item.id} item={item} locale={locale} />
            ))}
          </View>
        );
      })}
    </View>
  );
}

/** Contextual "Ask OpsWatch" entry: shown only when the server has AI. Sends a reference, never raw data. */
export function AskAiButton({ context, label, question }: { context: Ref; label: string; question: string }) {
  const router = useRouter();
  const enabled = useFeature('ai');
  if (!enabled) return null;
  return (
    <Button
      label={label}
      icon="sparkles-outline"
      variant="secondary"
      testID="ask-ai"
      onPress={() =>
        router.push({ pathname: '/ask', params: { contextType: context.type, contextId: context.id, question } } as unknown as Href)
      }
    />
  );
}

/**
 * Favorites: stored on the server when it supports them (`features.favorites`), otherwise on this device and
 * labelled so. Returns the list and a toggle.
 */
export function useFavorites() {
  const serverSide = useFeature('favorites');
  const { settings, update } = useSettings();
  const query = useServerFavorites(serverSide);
  const save = useSaveFavorites();
  const items: Favorite[] = serverSide ? (query.data ?? []) : settings.localFavorites;
  const isFavorite = (type: Favorite['type'], id: string) => items.some((f) => f.type === type && f.id === id);
  const toggle = (favorite: Favorite) => {
    const next = isFavorite(favorite.type, favorite.id) ? items.filter((f) => !(f.type === favorite.type && f.id === favorite.id)) : [...items, favorite];
    if (serverSide) save.mutate(next);
    else update({ localFavorites: next });
  };
  return { items, isFavorite, toggle, serverSide };
}

export function FavoriteButton({ favorite }: { favorite: Favorite }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { isFavorite, toggle } = useFavorites();
  const active = isFavorite(favorite.type, favorite.id);
  return (
    <Pressable
      onPress={() => toggle(favorite)}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={active ? t('action.unfavorite') : t('action.favorite')}
      hitSlop={10}
      style={styles.favorite}
      testID="favorite-toggle"
    >
      <Ionicons name={active ? 'star' : 'star-outline'} size={22} color={active ? colors.warning : colors.textMuted} />
    </Pressable>
  );
}

/** A card with a title row, for detail screens. */
export function DetailCard({ title, children, right }: { title?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <Card>
      {title || right ? (
        <View style={styles.cardHeader}>
          {title ? (
            <Text variant="subtitle" accessibilityRole="header" style={{ flex: 1 }}>
              {title}
            </Text>
          ) : (
            <View />
          )}
          {right}
        </View>
      ) : null}
      <View style={{ gap: spacing.sm }}>{children}</View>
    </Card>
  );
}

export function LinkRow({ href, title, subtitle, icon }: { href: string; title: string; subtitle?: string; icon?: IconName }) {
  const router = useRouter();
  return <Row title={title} subtitle={subtitle} icon={icon} onPress={() => router.push(href as Href)} />;
}

export { StateBadge };

const styles = StyleSheet.create({
  tile: { flexGrow: 1, flexBasis: '30%', minWidth: 100, padding: spacing.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, gap: 2 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  evidence: { flexDirection: 'row', gap: spacing.sm },
  evidenceTime: { width: 48, alignItems: 'center' },
  evidenceLine: { width: 2, flex: 1, marginTop: 4, borderRadius: 1 },
  evidenceBody: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.xs },
  evidenceHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, minHeight: 24 },
  evidenceLink: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  favorite: { padding: 6 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.sm },
});
