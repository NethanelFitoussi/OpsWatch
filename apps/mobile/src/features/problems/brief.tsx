/**
 * The Morning Brief headline: "Production: DEGRADED · 2 critical · 4 warnings · 18 healthy services", then the period.
 */
import { StyleSheet, View } from 'react-native';
import type { Brief } from '@/api/contract';
import { useI18n } from '@/i18n';
import { formatDateTime } from '@/lib/format';
import { HealthBadge } from '@/ui/badges';
import { Text } from '@/ui/text';
import { radius, spacing, toneColors, toneForHealth } from '@/ui/theme';
import { useTheme } from '@/ui/theme-provider';
import { briefCountsLine, briefHeadline } from './helpers';

export function BriefHeadline({ brief, environmentName }: { brief: Brief; environmentName: string }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const { fg, bg } = toneColors(colors, toneForHealth(brief.status));
  const headline = briefHeadline(t, environmentName, brief.status);
  const counts = briefCountsLine(t, brief.counts);
  return (
    <View style={[styles.card, { backgroundColor: bg, borderColor: fg }]} accessible accessibilityRole="summary" accessibilityLabel={`${headline}. ${counts}`} testID="brief-headline">
      <HealthBadge status={brief.status} size="large" />
      <Text variant="headline" style={{ color: colors.text }} testID="brief-status">
        {headline}
      </Text>
      <Text variant="body" weight="600" style={[styles.tabular, { color: colors.text }]} testID="brief-counts">
        {counts}
      </Text>
      <Text variant="small" tone="muted">
        {t('problems.brief.period', { from: formatDateTime(brief.period.from, locale), to: formatDateTime(brief.period.to, locale) })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg, gap: spacing.sm },
  tabular: { fontVariant: ['tabular-nums'] },
});
