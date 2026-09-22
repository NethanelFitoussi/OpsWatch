/**
 * Alert detail. The order answers the on-call's questions in the order they are asked: what fired and how bad, since
 * when, on what condition and what the metric reads now, then what to do about it, then the supporting detail.
 */
import { Stack } from 'expo-router';
import { useAlert } from '@/api/queries';
import { DetailCard } from '@/features/shared/components';
import { useI18n } from '@/i18n';
import { formatDateTime } from '@/lib/format';
import { TrendChart } from '@/ui/charts';
import { Card, KeyValue, Section } from '@/ui/layout';
import { QueryScreen } from '@/ui/screen';
import { useNow, useRelativeTime } from '@/ui/states';
import { Text } from '@/ui/text';
import { AcknowledgeAction, AlertHeader, AlertHistory, AlertLinks } from './components';

export function AlertDetailView({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const query = useAlert(id);
  const now = useNow();
  const relative = useRelativeTime();
  return (
    <QueryScreen query={query} testID="alert-screen">
      {(alert) => {
        const acknowledged = alert.acknowledgedBy !== undefined || alert.acknowledgedAt !== undefined;
        const hasLinks = alert.problemId !== undefined || alert.service !== undefined || alert.incidentId !== undefined;
        return (
          <>
            <Stack.Screen options={{ title: alert.name }} />
            <Card>
              <AlertHeader alert={alert} />
            </Card>

            {alert.metric ? (
              <DetailCard title={t('alerts.metric')}>
                <TrendChart series={alert.metric} height={140} testID="alert-metric" />
              </DetailCard>
            ) : null}

            <AcknowledgeAction alert={alert} />

            {acknowledged ? (
              <DetailCard title={t('alerts.status.acknowledged')}>
                <KeyValue label={t('alerts.acknowledgedBy')} value={alert.acknowledgedBy ?? t('state.noData')} />
                <KeyValue
                  label={t('alerts.acknowledgedAt')}
                  value={alert.acknowledgedAt === undefined ? t('state.noData') : `${formatDateTime(alert.acknowledgedAt, locale)} (${relative(alert.acknowledgedAt, now)})`}
                />
              </DetailCard>
            ) : null}

            {hasLinks ? (
              <Section title={t('alerts.actions')}>
                <AlertLinks alert={alert} />
              </Section>
            ) : null}

            <DetailCard title={t('alerts.details')}>
              <KeyValue label={t('alerts.source')} value={alert.source} />
              {alert.description ? <Text tone="muted">{alert.description}</Text> : null}
            </DetailCard>

            <DetailCard title={t('alerts.history')}>
              <AlertHistory history={alert.history} />
            </DetailCard>
          </>
        );
      }}
    </QueryScreen>
  );
}
