import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useInvestigation } from '@/api/queries';
import { ChronologicalTimeline, InvestigationHeader } from '@/features/investigations/components';
import { countByKind, INVESTIGATION_VIEWS, type InvestigationView } from '@/features/investigations/helpers';
import { EvidenceSections } from '@/features/shared/components';
import { useI18n } from '@/i18n';
import { isSafeId } from '@/lib/deep-links';
import { NotFoundState } from '@/ui/rows';
import { ChipGroup } from '@/ui/controls';
import { Card, Section } from '@/ui/layout';
import { QueryScreen } from '@/ui/screen';
import { FeatureGate } from '@/ui/states';
import { Text } from '@/ui/text';
import { spacing } from '@/ui/theme';

export default function InvestigationScreen() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!isSafeId(id)) return <NotFoundState />;
  return (
    <FeatureGate feature="investigations" label={t('nav.investigation')}>
      <InvestigationDetail id={id} />
    </FeatureGate>
  );
}

function InvestigationDetail({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const query = useInvestigation(id);
  const [view, setView] = useState<InvestigationView>('all');
  return (
    <QueryScreen query={query} testID="investigation-screen">
      {(investigation) => {
        const empty = investigation.timeline.length === 0;
        // In time order, hypotheses sit between facts. The tags say which is which; this says what a hypothesis is worth.
        const hasHypotheses = countByKind(investigation.timeline).hypothesis > 0;
        return (
          <>
            <InvestigationHeader investigation={investigation} />
            {investigation.summary ? (
              <Section title={t('investigations.summary')}>
                <Card>
                  <Text>{investigation.summary}</Text>
                </Card>
              </Section>
            ) : null}
            <Section title={t('investigations.timeline')}>
              {empty ? (
                <Text tone="muted">{t('investigations.empty')}</Text>
              ) : (
                <>
                  {/* The chip row is full-bleed like list filters. */}
                  <View style={{ marginHorizontal: -spacing.lg }}>
                    <ChipGroup
                      options={INVESTIGATION_VIEWS.map((value) => ({ value, label: value === 'all' ? t('investigations.all') : t('investigations.byKind') }))}
                      value={view}
                      onChange={setView}
                      accessibilityLabel={t('investigations.view')}
                    />
                  </View>
                  {view === 'all' ? (
                    <>
                      {hasHypotheses ? (
                        <Text variant="small" tone="muted" testID="timeline-hypothesis-note">
                          {t('investigations.timelineNote')}
                        </Text>
                      ) : null}
                      <ChronologicalTimeline timeline={investigation.timeline} locale={locale} />
                    </>
                  ) : (
                    <EvidenceSections evidence={investigation.timeline} locale={locale} />
                  )}
                </>
              )}
            </Section>
          </>
        );
      }}
    </QueryScreen>
  );
}
