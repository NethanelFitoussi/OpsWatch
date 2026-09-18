import { useBrief } from '@/api/queries';
import { BriefHeadline } from '@/features/problems/brief';
import { ChangesList, GeneratedAt, MostImportantProblem } from '@/features/home/components';
import { useCurrentEnvironment } from '@/features/shared/header';
import { useI18n } from '@/i18n';
import { Section } from '@/ui/layout';
import { QueryScreen } from '@/ui/screen';
import { FeatureGate, useNow } from '@/ui/states';

/** Reads top to bottom like a message: status and counts, what changed since yesterday, the one problem to look at. */
export default function BriefScreen() {
  const { t } = useI18n();
  const query = useBrief();
  const environment = useCurrentEnvironment();
  const now = useNow();
  return (
    <FeatureGate feature="brief" label={t('nav.brief')}>
      <QueryScreen query={query} testID="brief-screen">
        {(brief) => (
          <>
            <BriefHeadline brief={brief} environmentName={environment?.name ?? t('env.production')} />
            <Section title={t('brief.changes')}>
              <ChangesList changes={brief.changes} emptyLabel={t('brief.noChanges')} />
            </Section>
            <MostImportantProblem problem={brief.mostImportant} title={t('brief.mostImportant')} />
            <GeneratedAt at={brief.generatedAt} now={now} />
          </>
        )}
      </QueryScreen>
    </FeatureGate>
  );
}
