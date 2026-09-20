import { useBrief } from '@/api/queries';
import { BriefHeadline } from '@/features/problems/brief';
import { ChangeDigest, GeneratedAt, MostImportantProblem } from '@/features/home/components';
import { useCurrentEnvironment } from '@/features/shared/header';
import { useI18n } from '@/i18n';
import { Section } from '@/ui/layout';
import { QueryScreen } from '@/ui/screen';
import { FeatureGate, useNow } from '@/ui/states';

/**
 * Reads top to bottom like a briefing: the period and the status it covers, what changed grouped by movement, then
 * the one problem to look at, with a direct way in. The bottom line says when the server put it together.
 */
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
              <ChangeDigest changes={brief.changes} emptyLabel={t('brief.noChanges')} />
            </Section>
            <MostImportantProblem problem={brief.mostImportant} title={t('brief.mostImportant')} />
            <GeneratedAt at={brief.generatedAt} now={now} />
          </>
        )}
      </QueryScreen>
    </FeatureGate>
  );
}
