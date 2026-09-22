/**
 * Sections of the problem detail screen. Order follows the questions an on-call engineer asks: how bad, since when,
 * what can I do, what changed around it, what the evidence says.
 */
import { useEffect } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import type { ProblemDetail, RepositoryEvidence } from '@/api/contract';
import { useAcknowledgeProblem } from '@/api/queries';
import { DetailCard } from '@/features/shared/components';
import { useOpenRef } from '@/features/shared/navigation';
import { useI18n } from '@/i18n';
import { formatDateTime, formatDuration, formatMetric, shortSha } from '@/lib/format';
import { SeverityBadge } from '@/ui/badges';
import { TrendChart } from '@/ui/charts';
import { Button } from '@/ui/controls';
import { Card, Divider, KeyValue, Row } from '@/ui/layout';
import { errorMessageKey, useNow, useRelativeTime } from '@/ui/states';
import { Text } from '@/ui/text';
import { spacing } from '@/ui/theme';
import { ProblemStatusBadge, TrendIndicator } from './components';
import { deploymentCorrelationText, problemDuration } from './helpers';

export function ProblemHeader({ problem }: { problem: ProblemDetail }) {
  const { t, locale } = useI18n();
  const openRef = useOpenRef();
  const now = useNow();
  const relative = useRelativeTime();
  const duration = problemDuration(problem, now);
  const durationText = duration.ongoing ? t('problems.duration.ongoing', { duration: formatDuration(duration.ms) }) : formatDuration(duration.ms);
  return (
    <Card>
      <View style={styles.gap}>
        <View style={styles.badges}>
          <SeverityBadge severity={problem.severity} />
          <ProblemStatusBadge status={problem.status} testID="problem-status" />
          <TrendIndicator trend={problem.trend} />
        </View>
        <Text variant="title" accessibilityRole="header" testID="problem-title">
          {problem.title}
        </Text>
        {problem.summary ? <Text>{problem.summary}</Text> : null}
        <View>
          <KeyValue label={t('time.duration')} value={durationText} />
          <KeyValue label={t('time.firstSeen')} value={`${formatDateTime(problem.firstSeenAt, locale)} (${relative(problem.firstSeenAt, now)})`} />
          <KeyValue label={t('time.lastSeen')} value={relative(problem.lastSeenAt, now)} />
          <KeyValue label={t('metric.occurrences')} value={problem.occurrences === null ? t('metric.noData') : formatMetric(problem.occurrences, 'count')} />
          <KeyValue label={t('filter.category')} value={problem.category} />
          {problem.resource ? <KeyValue label={t('problems.resource')} value={problem.resource} mono /> : null}
        </View>
      </View>
      {problem.service ? (
        <>
          <Divider />
          <View style={styles.bleed}>
            <Row
              title={problem.service.label ?? problem.service.id}
              subtitle={t('problems.service')}
              icon="apps-outline"
              onPress={() => openRef(problem.service!)}
              testID="problem-service"
            />
          </View>
        </>
      ) : null}
    </Card>
  );
}

/** The acknowledge mutation, owned by the screen so the success notice outlives the button (which disappears once the
 * server stops allowing the action). Success is announced to screen readers. */
export function useAcknowledge(problemId: string) {
  const { t } = useI18n();
  const acknowledge = useAcknowledgeProblem(problemId);
  const done = acknowledge.isSuccess;
  useEffect(() => {
    if (done) AccessibilityInfo.announceForAccessibility(t('problems.acknowledge.done'));
  }, [done, t]);
  return acknowledge;
}

/** Acknowledge button with pending and failure states. Render it only when `allowedActions` includes 'acknowledge'. */
export function AcknowledgeAction({ acknowledge }: { acknowledge: ReturnType<typeof useAcknowledge> }) {
  const { t } = useI18n();
  return (
    <View style={styles.gap}>
      <Button
        label={t('action.acknowledge')}
        icon="hand-left-outline"
        variant="secondary"
        loading={acknowledge.isPending}
        onPress={() => acknowledge.mutate()}
        accessibilityHint={t('problems.acknowledge.hint')}
        testID="problem-acknowledge"
      />
      {acknowledge.isError ? (
        <Text variant="small" tone="critical" accessibilityLiveRegion="polite" testID="problem-acknowledge-error">
          {t('problems.acknowledge.failed', { reason: t(errorMessageKey(acknowledge.error)) })}
        </Text>
      ) : null}
    </View>
  );
}

export function AcknowledgedNotice() {
  const { t } = useI18n();
  return (
    <Text variant="small" tone="healthy" weight="600" accessibilityLiveRegion="polite" testID="problem-acknowledged">
      {t('problems.acknowledge.done')}
    </Text>
  );
}

export function DeploymentCorrelations({ deployments }: { deployments: ProblemDetail['deployments'] }) {
  const { t, locale } = useI18n();
  const openRef = useOpenRef();
  if (!deployments.length) return null;
  return (
    <DetailCard title={t('problems.deployments')}>
      <View testID="problem-deployments">
        {deployments.map(({ deployment, minutesBeforeProblem }, i) => (
          <View key={deployment.id}>
            {i > 0 ? <Divider /> : null}
            <View style={styles.bleed}>
              <Row
                title={deploymentCorrelationText(t, deployment, minutesBeforeProblem)}
                subtitle={[formatDateTime(deployment.at, locale), deployment.commit ? shortSha(deployment.commit.sha) : null].filter(Boolean).join(' · ')}
                icon="rocket-outline"
                numberOfLines={3}
                onPress={() => openRef({ type: 'deployment', id: deployment.id })}
                testID={`problem-deployment-${deployment.id}`}
              />
            </View>
          </View>
        ))}
      </View>
      <Text variant="small" tone="muted">
        {t('problems.deployments.note')}
      </Text>
    </DetailCard>
  );
}

export function MetricCharts({ metrics }: { metrics: ProblemDetail['metrics'] }) {
  const { t } = useI18n();
  if (!metrics.length) return null;
  return (
    <DetailCard title={t('problems.metrics')}>
      {metrics.map((series, i) => (
        <TrendChart key={series.id ?? `${series.label}-${i}`} series={series} testID={`problem-metric-${i}`} />
      ))}
    </DetailCard>
  );
}

/** Linked objects: errors, alerts and the incident, as tappable rows in one card. */
export function RelatedObjects({ problem }: { problem: ProblemDetail }) {
  const { t } = useI18n();
  const openRef = useOpenRef();
  const now = useNow();
  const relative = useRelativeTime();
  return (
    <>
      {problem.incident ? (
        <Card padded={false}>
          <Row
            title={problem.incident.label ?? problem.incident.id}
            subtitle={t('problems.incident')}
            icon="flame-outline"
            onPress={() => openRef(problem.incident!)}
            testID="problem-incident"
          />
        </Card>
      ) : null}
      {problem.errors.length ? (
        <DetailCard title={t('problems.errors')}>
          {problem.errors.map((error) => (
            <View key={error.id} style={styles.bleed}>
              <Row
                title={error.message}
                subtitle={[error.type, error.occurrences === null ? null : formatMetric(error.occurrences, 'count'), relative(error.lastSeenAt, now)].filter(Boolean).join(' · ')}
                icon="bug-outline"
                onPress={() => openRef({ type: 'error', id: error.id })}
              />
            </View>
          ))}
        </DetailCard>
      ) : null}
      {problem.alerts.length ? (
        <DetailCard title={t('problems.alerts')}>
          {problem.alerts.map((alert) => (
            <View key={alert.id} style={styles.bleed}>
              <Row title={alert.name} subtitle={alert.reason ?? alert.source} left={<SeverityBadge severity={alert.severity} />} onPress={() => openRef({ type: 'alert', id: alert.id })} />
            </View>
          ))}
        </DetailCard>
      ) : null}
    </>
  );
}

export function RepositoryEvidenceCards({ items }: { items: RepositoryEvidence[] }) {
  const { t } = useI18n();
  const openRef = useOpenRef();
  if (!items.length) return null;
  return (
    <DetailCard title={t('problems.repository')}>
      {items.map((item) => (
        <View key={item.id} style={styles.bleed}>
          <Row
            title={[item.file, item.lines ? t('evidence.lines', item.lines) : null].filter(Boolean).join(' · ') || item.repository}
            subtitle={[`${shortSha(item.commit.sha)}${item.commit.message ? ` ${item.commit.message}` : ''}`, item.summary].filter(Boolean).join('\n')}
            icon="code-slash-outline"
            numberOfLines={3}
            onPress={() => openRef({ type: 'evidence', id: item.id })}
            testID={`problem-evidence-${item.id}`}
          />
        </View>
      ))}
    </DetailCard>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  bleed: { marginHorizontal: -spacing.lg },
});
