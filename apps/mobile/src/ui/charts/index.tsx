/**
 * Small operational charts: sparkline, trend with thresholds and touch scrubbing, uptime strip, budget bar.
 * Each chart has a text alternative for screen readers, and nothing animates (reduced motion by construction).
 */
import { memo, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';
import type { Series } from '@/api/contract';
import { useI18n } from '@/i18n';
import { formatClock, formatMetric, formatPercentFraction } from '@/lib/format';
import { Text } from '../text';
import { radius, spacing } from '../theme';
import { useTheme } from '../theme-provider';
import { areaPath, domainOf, downsample, linePath, nearestIndex, scaleX, scaleY, summary } from './scale';

const MAX_POINTS = 120;

function useWidth(initial = 0): [number, (e: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(initial);
  return [width, (e) => setWidth(Math.round(e.nativeEvent.layout.width))];
}

export const Sparkline = memo(function Sparkline({ series, height = 32, color }: { series: Series; height?: number; color?: string }) {
  const { colors } = useTheme();
  const [width, onLayout] = useWidth();
  const points = useMemo(() => downsample(series.points, 60), [series.points]);
  const domain = useMemo(() => domainOf(points, [], { zeroBased: false }), [points]);
  return (
    <View style={{ height }} onLayout={onLayout} importantForAccessibility="no-hide-descendants">
      {width > 0 && domain ? (
        <Svg width={width} height={height}>
          <Path d={linePath(points, domain, width, height - 2)} stroke={color ?? colors.chartLine} strokeWidth={1.5} fill="none" />
        </Svg>
      ) : null}
    </View>
  );
});

export const TrendChart = memo(function TrendChart({ series, height = 150, testID }: { series: Series; height?: number; testID?: string }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const [width, onLayout] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const points = useMemo(() => downsample(series.points, MAX_POINTS), [series.points]);
  const warningAt = series.thresholds?.warning;
  const criticalAt = series.thresholds?.critical;
  const domain = useMemo(
    () => domainOf(points, [warningAt, criticalAt].filter((v): v is number => v !== undefined)),
    [points, warningAt, criticalAt],
  );
  const stats = useMemo(() => summary(series.points), [series.points]);
  const fmt = (v: number | null) => formatMetric(v, series.unit);

  const a11y = stats.latest === null
    ? t('a11y.chartNoData', { label: series.label })
    : t('a11y.chart', { label: series.label, value: fmt(stats.latest), min: fmt(stats.min), max: fmt(stats.max) });

  const activePoint = active !== null ? points[active] : undefined;

  const scrub = (x: number) => {
    if (!domain || width === 0) return;
    setActive(nearestIndex(points, domain, width, x));
  };

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={a11y} testID={testID}>
      <View style={styles.chartHeader}>
        <Text variant="small" weight="600" numberOfLines={1} style={{ flex: 1 }}>
          {series.label}
        </Text>
        <Text variant="small" weight="700" tone={activePoint ? 'primary' : 'default'}>
          {activePoint ? `${fmt(activePoint[1])} · ${formatClock(activePoint[0], locale)}` : fmt(stats.latest)}
        </Text>
      </View>
      <View
        style={{ height }}
        onLayout={onLayout}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => scrub(e.nativeEvent.locationX)}
        onResponderMove={(e) => scrub(e.nativeEvent.locationX)}
        onResponderRelease={() => setActive(null)}
        onResponderTerminate={() => setActive(null)}
        onResponderTerminationRequest={() => true}
      >
        {width > 0 && domain ? (
          <Svg width={width} height={height}>
            {[0.25, 0.5, 0.75].map((f) => (
              <Line key={f} x1={0} x2={width} y1={height * f} y2={height * f} stroke={colors.chartGrid} strokeWidth={1} />
            ))}
            {series.thresholds?.warning !== undefined ? (
              <Line x1={0} x2={width} y1={scaleY(series.thresholds.warning, domain, height)} y2={scaleY(series.thresholds.warning, domain, height)} stroke={colors.warning} strokeDasharray="4 4" strokeWidth={1} />
            ) : null}
            {series.thresholds?.critical !== undefined ? (
              <Line x1={0} x2={width} y1={scaleY(series.thresholds.critical, domain, height)} y2={scaleY(series.thresholds.critical, domain, height)} stroke={colors.critical} strokeDasharray="6 3" strokeWidth={1} />
            ) : null}
            <Path d={areaPath(points, domain, width, height)} fill={colors.chartFill} />
            <Path d={linePath(points, domain, width, height)} stroke={colors.chartLine} strokeWidth={2} fill="none" />
            {activePoint && activePoint[1] !== null ? (
              <Line x1={scaleX(activePoint[0], domain, width)} x2={scaleX(activePoint[0], domain, width)} y1={0} y2={height} stroke={colors.textMuted} strokeWidth={1} />
            ) : null}
          </Svg>
        ) : (
          <View style={[styles.noData, { backgroundColor: colors.surfaceAlt }]}>
            <Text tone="muted">{t('state.noData')}</Text>
          </View>
        )}
      </View>
      {domain ? (
        <View style={styles.axis}>
          <Text variant="caption" tone="faint">
            {formatClock(domain.minX, locale)}
          </Text>
          {series.thresholds?.critical !== undefined || series.thresholds?.warning !== undefined ? (
            <Text variant="caption" tone="faint" numberOfLines={1}>
              {[series.thresholds?.warning !== undefined ? `⚠ ${fmt(series.thresholds.warning)}` : null, series.thresholds?.critical !== undefined ? `⛔ ${fmt(series.thresholds.critical)}` : null]
                .filter(Boolean)
                .join('  ')}
            </Text>
          ) : null}
          <Text variant="caption" tone="faint">
            {formatClock(domain.maxX, locale)}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

/** One bar per period: up, down, or no data (grey, never counted as up). */
export const UptimeBar = memo(function UptimeBar({ buckets, height = 28 }: { buckets: { at: number; up: boolean | null }[]; height?: number }) {
  const { colors } = useTheme();
  const [width, onLayout] = useWidth();
  const down = buckets.filter((b) => b.up === false).length;
  const unknown = buckets.filter((b) => b.up === null).length;
  const gap = 2;
  const barWidth = buckets.length ? Math.max(1, (width - gap * (buckets.length - 1)) / buckets.length) : 0;
  return (
    <View
      style={{ height }}
      onLayout={onLayout}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${buckets.length - down - unknown} up, ${down} down, ${unknown} no data`}
    >
      {width > 0 ? (
        <Svg width={width} height={height}>
          {buckets.map((b, i) => (
            <Rect
              key={b.at}
              x={i * (barWidth + gap)}
              y={b.up === false ? 0 : b.up === null ? height * 0.35 : height * 0.2}
              width={barWidth}
              height={b.up === false ? height : b.up === null ? height * 0.3 : height * 0.8}
              rx={1}
              fill={b.up === false ? colors.critical : b.up === null ? colors.unknownBg : colors.healthy}
            />
          ))}
        </Svg>
      ) : null}
    </View>
  );
});

/** Error budget remaining as a bar; negative (exhausted) budgets render as an empty red bar with the overshoot. */
export function BudgetBar({ remaining }: { remaining: number | null }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  if (remaining === null) {
    return (
      <Text variant="small" tone="muted">
        {t('state.noData')}
      </Text>
    );
  }
  const clamped = Math.max(0, Math.min(1, remaining));
  const color = remaining <= 0 ? colors.critical : remaining < 0.25 ? colors.warning : colors.healthy;
  return (
    <View accessible accessibilityLabel={formatPercentFraction(remaining)}>
      <View style={[styles.budgetTrack, { backgroundColor: colors.surfaceAlt, borderColor: remaining <= 0 ? colors.critical : colors.border }]}>
        <View style={{ width: `${clamped * 100}%`, backgroundColor: color, height: '100%', borderRadius: radius.pill }} />
      </View>
      <Text variant="small" weight="700" style={{ color, marginTop: 4 }}>
        {formatPercentFraction(remaining)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chartHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2, gap: spacing.sm },
  noData: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  budgetTrack: { height: 10, borderRadius: radius.pill, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
});
