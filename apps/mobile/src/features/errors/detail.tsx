/**
 * Error group detail: what failed, where, how often, the stack trace, representative logs and where to go next.
 */
import { View } from 'react-native';
import type { ErrorDetail } from '@/api/contract';
import { AskAiButton, DetailCard, MetricTile, TileGrid } from '@/features/shared/components';
import { formatLogTime, levelLabelKey } from '@/features/logs/helpers';
import { useOpenRef } from '@/features/shared/navigation';
import { useI18n } from '@/i18n';
import { formatDateTime } from '@/lib/format';
import { TrendChart } from '@/ui/charts';
import { StackTraceViewer, LogBlock } from '@/ui/code';
import { CopyButton } from '@/ui/controls';
import { Card, Divider, KeyValue, Row, Section } from '@/ui/layout';
import { useNow, useRelativeTime } from '@/ui/states';
import { Text } from '@/ui/text';
import { monoFont, spacing } from '@/ui/theme';
import { ErrorStatusBadge } from './components';

export function ErrorHeader({ error }: { error: ErrorDetail }) {
  const { t } = useI18n();
  return (
    <DetailCard right={<CopyButton text={error.message} testID="copy-error-message" />}>
      <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', alignItems: 'center' }}>
        <ErrorStatusBadge status={error.status} size="large" />
        {error.type ? (
          <Text variant="small" weight="700" tone="muted" style={{ fontFamily: monoFont }}>
            {error.type}
          </Text>
        ) : null}
      </View>
      <Text variant="body" weight="600" style={{ fontFamily: monoFont }} selectable accessibilityRole="header" testID="error-message" accessibilityLabel={`${t('errors.message')}: ${error.message}`}>
        {error.message}
      </Text>
    </DetailCard>
  );
}

/** Next steps, most useful first: the problem this error belongs to, then the AI explanation. */
export function ErrorNextSteps({ error }: { error: ErrorDetail }) {
  const { t } = useI18n();
  const openRef = useOpenRef();
  return (
    <View style={{ gap: spacing.sm }}>
      {error.problemId ? (
        <Card padded={false}>
          <Row
            title={t('errors.relatedProblem')}
            subtitle={t('errors.relatedProblemHint')}
            icon="flame-outline"
            onPress={() => openRef({ type: 'problem', id: error.problemId! })}
            testID="error-problem-link"
          />
        </Card>
      ) : null}
      <AskAiButton context={{ type: 'error', id: error.id }} label={t('errors.explain')} question={t('errors.explainQuestion')} />
    </View>
  );
}

export function ErrorFacts({ error }: { error: ErrorDetail }) {
  const { t, locale } = useI18n();
  const openRef = useOpenRef();
  const now = useNow();
  const relative = useRelativeTime();
  const noData = t('metric.noData');
  return (
    <>
      <TileGrid>
        <MetricTile label={t('metric.occurrences')} value={{ value: error.occurrences, unit: 'count', status: null }} testID="error-occurrences" />
        <MetricTile label={t('errors.instances')} value={{ value: error.affectedInstances, unit: 'count', status: null }} testID="error-instances" />
      </TileGrid>
      {error.service ? (
        <Card padded={false}>
          <Row
            title={error.service.label ?? error.service.id}
            subtitle={t('errors.affectedService')}
            icon="server-outline"
            onPress={() => openRef({ type: 'service', id: error.service!.id })}
            testID="error-service-link"
          />
        </Card>
      ) : null}
      <DetailCard>
        <KeyValue label={t('errors.route')} value={error.route ?? noData} mono={!!error.route} />
        <KeyValue label={t('time.firstSeen')} value={`${formatDateTime(error.firstSeenAt, locale)} (${relative(error.firstSeenAt, now)})`} />
        <KeyValue label={t('time.lastSeen')} value={`${formatDateTime(error.lastSeenAt, locale)} (${relative(error.lastSeenAt, now)})`} />
      </DetailCard>
      {error.trend ? (
        <Section title={t('errors.trend')}>
          <Card>
            <TrendChart series={error.trend} testID="error-trend" />
          </Card>
        </Section>
      ) : null}
    </>
  );
}

export function ErrorStack({ error }: { error: ErrorDetail }) {
  const { t } = useI18n();
  return (
    <Section title={t('errors.stackTrace')}>
      {error.frames.length || error.rawStack ? (
        <StackTraceViewer frames={error.frames} rawStack={error.rawStack} testID="error-stack" />
      ) : (
        <Text tone="muted">{t('errors.noStack')}</Text>
      )}
    </Section>
  );
}

export function ErrorInstances({ instances }: { instances: string[] }) {
  const { t } = useI18n();
  if (!instances.length) return null;
  return (
    <Section title={t('errors.instancesList')}>
      <Card padded={false}>
        {instances.map((instance, i) => (
          <View key={instance}>
            {i > 0 ? <Divider /> : null}
            <Row title={instance} icon="cube-outline" numberOfLines={1} />
          </View>
        ))}
      </Card>
    </Section>
  );
}

export function ErrorSampleLogs({ error }: { error: ErrorDetail }) {
  const { t } = useI18n();
  return (
    <Section title={t('errors.sampleLogs')}>
      {error.sampleLogs.length ? (
        error.sampleLogs.map((log) => (
          <View key={log.id} testID={`error-sample-log-${log.id}`}>
            <LogBlock message={log.message} title={[formatLogTime(log.timestamp), t(levelLabelKey(log.level)), log.service].filter(Boolean).join(' · ')} />
          </View>
        ))
      ) : (
        <Text tone="muted">{t('errors.noSampleLogs')}</Text>
      )}
    </Section>
  );
}
