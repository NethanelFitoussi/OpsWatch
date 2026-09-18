/**
 * Small building blocks reused by the Services, Infrastructure and Deployments screens.
 */
import { Fragment, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { MetricValue, Series } from '@/api/contract';
import { useI18n } from '@/i18n';
import { formatMetric } from '@/lib/format';
import { TrendChart } from '@/ui/charts';
import { Card, Divider } from '@/ui/layout';
import { Text } from '@/ui/text';
import { spacing } from '@/ui/theme';
import { useTheme } from '@/ui/theme-provider';

/** Items drawn as rows of one grouped card, separated by hairlines. */
export function CardList<T>({ items, keyOf, render }: { items: T[]; keyOf: (item: T) => string; render: (item: T) => ReactNode }) {
  return (
    <Card padded={false}>
      {items.map((item, i) => (
        <Fragment key={keyOf(item)}>
          {i > 0 ? <Divider /> : null}
          {render(item)}
        </Fragment>
      ))}
    </Card>
  );
}

/** One trend chart per series, each in its own card. */
export function SeriesCharts({ series }: { series: Series[] }) {
  return (
    <View style={styles.charts}>
      {series.map((s, i) => (
        <Card key={s.id ?? `${s.label}-${i}`}>
          <TrendChart series={s} height={120} />
        </Card>
      ))}
    </View>
  );
}

/** A label and a value on one line for list rows. `null` reads "No data", never 0. */
export function CompactMetric({ label, value, testID }: { label: string; value: MetricValue; testID?: string }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const noData = value.value === null;
  const color = noData ? colors.textFaint : value.status === 'critical' ? colors.critical : value.status === 'warning' ? colors.warning : colors.text;
  const text = noData ? t('metric.noData') : formatMetric(value.value, value.unit);
  return (
    <View style={styles.metric} testID={testID} accessible accessibilityLabel={`${label}: ${text}`}>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {label}
      </Text>
      <Text variant="small" weight="700" style={{ color, fontVariant: ['tabular-nums'] }} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  charts: { gap: spacing.sm },
  metric: { flexShrink: 1, minWidth: 64 },
});
