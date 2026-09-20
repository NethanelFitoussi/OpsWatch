import { useLocalSearchParams } from 'expo-router';
import { useProblem } from '@/api/queries';
import {
  AcknowledgeAction,
  AcknowledgedNotice,
  DeploymentCorrelations,
  MetricCharts,
  ProblemHeader,
  RelatedObjects,
  RepositoryEvidenceCards,
  useAcknowledge,
} from '@/features/problems/detail';
import { problemEvidence } from '@/features/problems/helpers';
import { AskAiButton, EvidenceSections } from '@/features/shared/components';
import { useOpenRef } from '@/features/shared/navigation';
import { useI18n } from '@/i18n';
import { isSafeId } from '@/lib/deep-links';
import { Button } from '@/ui/controls';
import { Card, Section } from '@/ui/layout';
import { QueryScreen } from '@/ui/screen';
import { EmptyState, FeatureGate } from '@/ui/states';
import { Text } from '@/ui/text';

export default function ProblemDetailScreen() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!isSafeId(id)) return <EmptyState title={t('error.not_found')} icon="help-circle-outline" />;
  return (
    <FeatureGate feature="problems" label={t('tab.problems')}>
      <ProblemDetail id={id} />
    </FeatureGate>
  );
}

function ProblemDetail({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const openRef = useOpenRef();
  const query = useProblem(id);
  const acknowledge = useAcknowledge(id);
  return (
    <QueryScreen query={query} testID="problem-screen">
      {(problem) => {
        const evidence = problemEvidence(problem);
        return (
          <>
            <ProblemHeader problem={problem} />

            {problem.allowedActions.includes('acknowledge') ? <AcknowledgeAction acknowledge={acknowledge} /> : null}
            {acknowledge.isSuccess ? <AcknowledgedNotice /> : null}
            {problem.investigationId ? (
              <Button
                label={t('problems.openInvestigation')}
                icon="git-branch-outline"
                onPress={() => openRef({ type: 'investigation', id: problem.investigationId! })}
                testID="problem-open-investigation"
              />
            ) : null}
            {problem.description ? (
              <Section title={t('problems.summary')}>
                <Card>
                  <Text>{problem.description}</Text>
                </Card>
              </Section>
            ) : null}

            <DeploymentCorrelations deployments={problem.deployments} />
            <MetricCharts metrics={problem.metrics} />
            <RelatedObjects problem={problem} />
            <RepositoryEvidenceCards items={problem.repository} />

            {/* Empty sections are left out entirely rather than shown as empty shells. */}
            {evidence.length ? (
              <Section title={t('problems.evidence')}>
                <EvidenceSections evidence={evidence} locale={locale} />
              </Section>
            ) : null}

            {/* An AI aid, below the facts it would comment on, never above the actions that change the problem. */}
            <AskAiButton context={{ type: 'problem', id: problem.id }} label={t('problems.ask')} question={t('problems.ask')} />
          </>
        );
      }}
    </QueryScreen>
  );
}
