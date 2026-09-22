/**
 * Synthetic check detail: is it up, what does it hit, how available and fast it has been, certificate state, and the
 * most recent failures.
 */
import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSynthetic } from '@/api/queries';
import { DetailCard, FavoriteButton, MetricTile, TileGrid } from '@/features/shared/components';
import { useOpenRef } from '@/features/shared/navigation';
import { useI18n } from '@/i18n';
import { TrendChart } from '@/ui/charts';
import { Button, CopyButton } from '@/ui/controls';
import { Card, KeyValue } from '@/ui/layout';
import { QueryScreen } from '@/ui/screen';
import { useNow, useRelativeTime } from '@/ui/states';
import { Text } from '@/ui/text';
import { spacing } from '@/ui/theme';
import { StatusBadge } from '@/ui/rows';
import { AvailabilityStrip, FailureList, SslBadge, SslBlock, useSyntheticStatus } from './components';
import { classifySsl, sslNeedsAttention } from './helpers';

export function SyntheticDetailView({ id }: { id: string }) {
  const { t } = useI18n();
  const query = useSynthetic(id);
  const status = useSyntheticStatus();
  const openRef = useOpenRef();
  const now = useNow();
  const relative = useRelativeTime();
  return (
    <QueryScreen query={query} testID="synthetic-screen">
      {(synthetic) => {
        const ssl = classifySsl(synthetic.ssl, now);
        return (
        <>
          <Stack.Screen options={{ title: synthetic.name }} />
          <Card>
            <View style={styles.header}>
              <View style={styles.top}>
                <StatusBadge meta={status(synthetic.status)} size="large" testID="synthetic-status" />
                <FavoriteButton favorite={{ type: 'synthetic', id: synthetic.id, label: synthetic.name }} />
              </View>
              {/* An expiring certificate takes the site down on a date nobody is watching: it belongs at the top. */}
              {sslNeedsAttention(ssl) ? <SslBadge state={ssl} testID="synthetic-ssl-flag" /> : null}
              <Text variant="title" accessibilityRole="header">
                {synthetic.name}
              </Text>
              <Text variant="mono" selectable testID="synthetic-target">
                {synthetic.target}
              </Text>
              <View style={styles.row}>
                <Text variant="small" tone="muted" style={styles.flex}>
                  {t('synthetics.kind', { kind: synthetic.kind.toUpperCase() })}
                </Text>
                <CopyButton text={synthetic.target} label={t('synthetics.copyTarget')} />
              </View>
              <KeyValue label={t('synthetics.lastChecked')} value={synthetic.lastCheckedAt === null ? t('synthetics.neverRun') : relative(synthetic.lastCheckedAt, now)} />
            </View>
          </Card>

          {synthetic.problem ? (
            <Button label={t('action.openProblem')} icon="alert-circle-outline" variant="secondary" onPress={() => openRef(synthetic.problem!)} testID="synthetic-open-problem" />
          ) : null}

          {/* Failures before figures: what broke, and when, is what the on-call opened this screen for. */}
          <DetailCard title={t('synthetics.failures')}>
            <FailureList failures={synthetic.failures} />
          </DetailCard>

          <TileGrid>
            <MetricTile label={t('synthetics.availability24h')} value={{ value: synthetic.availability24h, unit: 'ratio', status: null }} testID="synthetic-availability" />
            <MetricTile label={t('synthetics.uptime30d')} value={{ value: synthetic.uptime30d, unit: 'ratio', status: null }} />
            <MetricTile label={t('synthetics.latency')} value={{ value: synthetic.latencyMs, unit: 'ms', status: null }} />
          </TileGrid>

          <DetailCard title={t('synthetics.availabilityTitle')}>
            <AvailabilityStrip buckets={synthetic.availability} />
          </DetailCard>

          {synthetic.latency ? (
            <DetailCard title={t('synthetics.latency')}>
              <TrendChart series={synthetic.latency} height={130} testID="synthetic-latency" />
            </DetailCard>
          ) : null}

          <DetailCard title={t('synthetics.ssl.title')}>
            <SslBlock ssl={synthetic.ssl} now={now} />
          </DetailCard>
        </>
        );
      }}
    </QueryScreen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
});
