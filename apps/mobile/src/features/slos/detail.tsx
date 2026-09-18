/**
 * SLO detail: status, target against current, error budget and burn rate, then the performance and budget charts.
 * An SLO without data yet shows "No data" everywhere instead of zeros.
 */
import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSlo } from '@/api/queries';
import { StatusBadge } from '@/features/alerts/building-blocks';
import { DetailCard, MetricTile, TileGrid } from '@/features/shared/components';
import { useOpenRef } from '@/features/shared/navigation';
import { useI18n } from '@/i18n';
import { TrendChart } from '@/ui/charts';
import { Button } from '@/ui/controls';
import { Card, KeyValue } from '@/ui/layout';
import { QueryScreen } from '@/ui/screen';
import { Text } from '@/ui/text';
import { spacing } from '@/ui/theme';
import { BudgetBlock, useSloStatus } from './components';

const CHART_HEIGHT = 120;

export function SloDetailView({ id }: { id: string }) {
  const { t } = useI18n();
  const query = useSlo(id);
  const status = useSloStatus();
  const openRef = useOpenRef();
  return (
    <QueryScreen query={query} testID="slo-screen">
      {(slo) => (
        <>
          <Stack.Screen options={{ title: slo.name }} />
          <Card>
            <View style={styles.header}>
              <StatusBadge meta={status(slo.status)} size="large" testID="slo-status" />
              <Text variant="title" accessibilityRole="header">
                {slo.name}
              </Text>
              {slo.description ? <Text tone="muted">{slo.description}</Text> : null}
              <KeyValue label={t('slos.window')} value={slo.window} />
            </View>
          </Card>

          <TileGrid>
            <MetricTile label={t('slos.target')} value={{ value: slo.target, unit: 'ratio', status: null }} testID="slo-target" />
            <MetricTile
              label={t('slos.current')}
              value={{ value: slo.current, unit: 'ratio', status: slo.status === 'breached' ? 'critical' : slo.status === 'at_risk' ? 'warning' : null }}
              testID="slo-current"
            />
          </TileGrid>

          <DetailCard title={t('slos.budgetRemaining')}>
            <BudgetBlock slo={slo} />
          </DetailCard>

          {slo.service ? (
            <Button label={t('action.openService')} icon="apps-outline" variant="secondary" onPress={() => openRef(slo.service!)} testID="slo-open-service" />
          ) : null}

          {slo.performance || slo.budget ? (
            <>
              {slo.performance ? (
                <DetailCard title={t('slos.performance')}>
                  <TrendChart series={slo.performance} height={CHART_HEIGHT} testID="slo-performance" />
                </DetailCard>
              ) : null}
              {slo.budget ? (
                <DetailCard title={t('slos.budgetChart')}>
                  <TrendChart series={slo.budget} height={CHART_HEIGHT} testID="slo-budget-chart" />
                </DetailCard>
              ) : null}
            </>
          ) : (
            <DetailCard title={t('slos.performance')}>
              <Text tone="muted" testID="slo-no-series">
                {t('slos.noSeries')}
              </Text>
            </DetailCard>
          )}
        </>
      )}
    </QueryScreen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm },
});
