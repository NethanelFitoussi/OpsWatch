import { useSlos } from '@/api/queries';
import { SloRow } from '@/features/slos/components';
import { useI18n } from '@/i18n';
import { ListScreen } from '@/ui/list-screen';
import { FeatureGate } from '@/ui/states';

export default function SlosScreen() {
  const { t } = useI18n();
  const query = useSlos();
  return (
    <FeatureGate feature="slos" label={t('nav.slos')}>
      <ListScreen
        testID="slos-screen"
        query={query}
        keyExtractor={(slo) => slo.id}
        renderItem={({ item }) => <SloRow slo={item} />}
        empty={{ title: t('slos.empty'), body: t('slos.emptyBody'), icon: 'speedometer-outline' }}
      />
    </FeatureGate>
  );
}
