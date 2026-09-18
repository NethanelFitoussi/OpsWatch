/**
 * Alert detail: what fired, since when, why, what to do next, then the evidence (condition, metric, history).
 */
import { Stack } from 'expo-router';
import { useAlert } from '@/api/queries';
import { DetailCard } from '@/features/shared/components';
import { useI18n } from '@/i18n';
import { formatDateTime } from '@/lib/format';
import { TrendChart } from '@/ui/charts';
import { Card, KeyValue, Section } from '@/ui/layout';
import { QueryScreen } from '@/ui/screen';
import { Text } from '@/ui/text';
import { AcknowledgeAction, AlertHeader, AlertHistory, AlertLinks } from './components';

export function AlertDetailView({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const query = useAlert(id);
  return (
    <QueryScreen query={query} testID="alert-screen">
      {(alert) => (
        <>
          <Stack.Screen options={{ title: alert.name }} />
          <Card>
            <AlertHeader alert={alert} />
          </Card>

          <Section title={t('alerts.actions')}>
            <AcknowledgeAction alert={alert} />
            <AlertLinks alert={alert} />
          </Section>

          {alert.acknowledgedBy || alert.acknowledgedAt ? (
            <DetailCard title={t('alerts.status.acknowledged')}>
              <KeyValue label={t('alerts.acknowledgedBy')} value={alert.acknowledgedBy ?? t('state.noData')} />
              <KeyValue label={t('alerts.acknowledgedAt')} value={alert.acknowledgedAt ? formatDateTime(alert.acknowledgedAt, locale) : t('state.noData')} />
            </DetailCard>
          ) : null}

          <DetailCard title={t('alerts.details')}>
            <KeyValue label={t('alerts.source')} value={alert.source} />
            {alert.condition ? <KeyValue label={t('alerts.condition')} value={alert.condition} mono /> : null}
            <KeyValue label={t('alerts.started')} value={alert.since === null ? t('state.noData') : formatDateTime(alert.since, locale)} />
            {alert.description ? <Text tone="muted">{alert.description}</Text> : null}
          </DetailCard>

          {alert.metric ? (
            <DetailCard title={t('alerts.metric')}>
              <TrendChart series={alert.metric} height={140} testID="alert-metric" />
            </DetailCard>
          ) : null}

          <DetailCard title={t('alerts.history')}>
            <AlertHistory history={alert.history} />
          </DetailCard>
        </>
      )}
    </QueryScreen>
  );
}
