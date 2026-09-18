/**
 * Deployment detail body: what was deployed, where and when, the commit and its size, then the problems that started
 * afterwards (timing facts, never causes) and the repository evidence.
 */
import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { DeploymentDetail } from '@/api/contract';
import { useDeployment } from '@/api/queries';
import { AskAiButton, DetailCard } from '@/features/shared/components';
import { useOpenRef } from '@/features/shared/navigation';
import { useI18n } from '@/i18n';
import { formatDateTime, shortSha } from '@/lib/format';
import { CopyButton } from '@/ui/controls';
import { Card, KeyValue, Row, Section } from '@/ui/layout';
import { QueryScreen } from '@/ui/screen';
import { useNow, useRelativeTime } from '@/ui/states';
import { Text } from '@/ui/text';
import { spacing } from '@/ui/theme';
import { useTheme } from '@/ui/theme-provider';
import { CardList } from '@/ui/data';
import { DeploymentStatusBadge, EvidenceRow, ProblemsAfterDeployment } from './components';

export function DeploymentDetailScreen({ id }: { id: string }) {
  const query = useDeployment(id);
  return (
    <QueryScreen query={query} testID="deployment-screen">
      {(deployment) => <DeploymentBody deployment={deployment} />}
    </QueryScreen>
  );
}

function DeploymentBody({ deployment }: { deployment: DeploymentDetail }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const openRef = useOpenRef();
  const now = useNow();
  const relative = useRelativeTime();
  const serviceName = deployment.service.label ?? deployment.service.id;
  const { commit, changes } = deployment;
  return (
    <>
      <Stack.Screen options={{ title: `${serviceName} ${deployment.version}` }} />
      <Card>
        <View style={styles.header} testID="deployment-header">
          <DeploymentStatusBadge status={deployment.status} size="large" />
          <Text variant="title" accessibilityRole="header">
            {`${serviceName} ${deployment.version}`}
          </Text>
          <Text tone="muted">{[deployment.environment, `${formatDateTime(deployment.at, locale)} (${relative(deployment.at, now)})`].filter(Boolean).join(' · ')}</Text>
          {deployment.description ? <Text>{deployment.description}</Text> : null}
        </View>
      </Card>

      <Card padded={false}>
        <Row title={serviceName} subtitle={t('deployments.service')} icon="apps-outline" onPress={() => openRef(deployment.service)} testID="deployment-service" />
      </Card>

      {commit || deployment.repository ? (
        <DetailCard title={t('deployments.commit')} right={commit ? <CopyButton text={commit.sha} testID="copy-sha" /> : undefined}>
          {commit ? <KeyValue label={t('deployments.sha')} value={shortSha(commit.sha)} mono /> : null}
          {commit?.message ? <KeyValue label={t('deployments.message')} value={commit.message} /> : null}
          {commit?.author ? <KeyValue label={t('deployments.author')} value={commit.author} /> : null}
          {deployment.repository ? <KeyValue label={t('deployments.repository')} value={deployment.repository} mono /> : null}
          {changes ? (
            <KeyValue
              label={t('deployments.changes')}
              value={
                <Text variant="small" weight="600" testID="deployment-changes" accessibilityLabel={[t('deployments.files', { count: changes.files }), t('deployments.additions', { count: changes.additions }), t('deployments.deletions', { count: changes.deletions })].join(', ')}>
                  {`${t('deployments.files', { count: changes.files })} · `}
                  <Text variant="small" weight="700" style={{ color: colors.diffAdd }}>{`+${changes.additions}`}</Text>
                  {' · '}
                  <Text variant="small" weight="700" style={{ color: colors.diffRemove }}>{`−${changes.deletions}`}</Text>
                </Text>
              }
            />
          ) : null}
        </DetailCard>
      ) : null}

      <Section title={t('deployments.problemsAfter')}>
        <ProblemsAfterDeployment related={deployment.relatedProblems} />
      </Section>

      {deployment.evidence.length ? (
        <Section title={t('deployments.evidence')}>
          <CardList items={deployment.evidence} keyOf={(e) => e.id} render={(e) => <EvidenceRow evidence={e} />} />
        </Section>
      ) : null}

      <AskAiButton
        context={{ type: 'deployment', id: deployment.id }}
        label={t('deployments.analyze')}
        question={t('deployments.analyzeQuestion', { service: serviceName, version: deployment.version })}
      />
    </>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm },
});
