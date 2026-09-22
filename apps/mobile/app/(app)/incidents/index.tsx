import { useIncidents } from '@/api/queries';
import { IncidentRow } from '@/features/incidents/components';
import { useI18n } from '@/i18n';
import { InfiniteListScreen } from '@/ui/list-screen';
import { FeatureGate, useNow } from '@/ui/states';

export default function IncidentsScreen() {
  const { t } = useI18n();
  const query = useIncidents();
  const now = useNow();
  return (
    <FeatureGate feature="incidents" label={t('nav.incidents')}>
      <InfiniteListScreen
        testID="incidents-screen"
        query={query}
        keyExtractor={(incident) => incident.id}
        renderItem={({ item }) => <IncidentRow incident={item} now={now} />}
        empty={{ title: t('incidents.empty'), body: t('incidents.emptyBody'), icon: 'shield-checkmark-outline' }}
      />
    </FeatureGate>
  );
}
