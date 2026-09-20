/**
 * Error group detail, in the order an incident is read: what happened, how bad it is, where, the stack trace, the
 * representative logs, and only then the objects this error is related to.
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
import { ErrorStatusBadge, ErrorStatusMeaning } from './components';
import { hasStack, stackCopyText } from './helpers';

export function ErrorHeader({ error }: { error: ErrorDetail }) {
  const { t } = useI18n();
  return (
    <DetailCard right={<CopyButton text={error.message} label={t('errors.copyMessage')} testID="copy-error-message" />}>
      <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', alignItems: 'center' }}>
        <ErrorStatusBadge status={error.status} size="large" />
        {error.type ? (
          <Text variant="small" weight="700" tone="muted" style={{ fontFamily: monoFont }}>
            {error.type}
          </Text>
        ) : null}
      </View>
      {/* The status word alone does not say why it matters, so the detail always spells it out. */}
      <ErrorStatusMeaning status={error.status} />
      <Text variant="body" weight="600" style={{ fontFamily: monoFont }} selectable accessibilityRole="header" testID="error-message" accessibilityLabel={`${t('errors.message')}: ${error.message}`}>
        {error.message}
      </Text>
    </DetailCard>
  );
}

/** Related objects: the problem this error belongs to, then the AI explanation. Last, once the evidence is read. */
export function ErrorRelated({ error }: { error: ErrorDetail }) {
  const { t } = useI18n();
  const openRef = useOpenRef();
  return (
    <Section title={t('errors.related')}>
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
    </Section>
  );
}

/** How bad it is and where it happens: the two counts, the service, the route and the two timestamps. */
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

/**
 * The stack trace. When the server sent a raw stack the viewer already offers to copy it, so the section adds a Copy
 * only for the other case — parsed frames and no `rawStack`, which until now could not be copied at all. What it
 * gives is the error line plus one `at …` line per frame: a self-contained trace to paste into a ticket.
 */
export function ErrorStack({ error }: { error: ErrorDetail }) {
  const { t } = useI18n();
  const available = hasStack(error);
  const copyable = available && !error.rawStack;
  return (
    <Section
      title={t('errors.stackTrace')}
      action={copyable ? <CopyButton text={stackCopyText(error)} label={t('errors.copyStack')} testID="copy-error-stack" /> : undefined}
    >
      {available ? (
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
