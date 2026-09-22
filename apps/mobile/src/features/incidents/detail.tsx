/**
 * Incident detail: severity, status, duration and summary first, then what is affected, what happened, and notes.
 */
import { Stack } from 'expo-router';
import { View } from 'react-native';
import { useIncident } from '@/api/queries';
import { AskAiButton, DetailCard, ProblemRow } from '@/features/shared/components';
import { useI18n } from '@/i18n';
import { Card, Divider, Section } from '@/ui/layout';
import { QueryScreen } from '@/ui/screen';
import { Text } from '@/ui/text';
import { AffectedServices, IncidentHeader, IncidentNotes, IncidentTimeline } from './components';

export function IncidentDetailView({ id }: { id: string }) {
  const { t } = useI18n();
  const query = useIncident(id);
  return (
    <QueryScreen query={query} testID="incident-screen">
      {(incident) => (
        <>
          <Stack.Screen options={{ title: incident.title }} />
          <Card>
            <IncidentHeader incident={incident} />
          </Card>

          <AskAiButton context={{ type: 'incident', id: incident.id }} label={t('incidents.summarize')} question={t('incidents.summarizeQuestion')} />

          {incident.resolution ? (
            <DetailCard title={t('incidents.resolution')}>
              <Text selectable>{incident.resolution}</Text>
            </DetailCard>
          ) : null}

          {incident.affectedServices.length ? (
            <Section title={t('incidents.affectedServices')}>
              <AffectedServices services={incident.affectedServices} />
            </Section>
          ) : null}

          <DetailCard title={t('incidents.timeline')}>
            {incident.timeline.length ? (
              <IncidentTimeline timeline={incident.timeline} />
            ) : (
              <Text variant="small" tone="muted">
                {t('incidents.timelineEmpty')}
              </Text>
            )}
          </DetailCard>

          {incident.problems.length ? (
            <Section title={t('incidents.relatedProblems')}>
              <Card padded={false}>
                {incident.problems.map((problem, i) => (
                  <View key={problem.id}>
                    {i > 0 ? <Divider /> : null}
                    <ProblemRow problem={problem} />
                  </View>
                ))}
              </Card>
            </Section>
          ) : null}

          {incident.notes.length ? (
            <DetailCard title={t('incidents.notes')}>
              <IncidentNotes notes={incident.notes} />
            </DetailCard>
          ) : null}
        </>
      )}
    </QueryScreen>
  );
}
