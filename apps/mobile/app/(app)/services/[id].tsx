import { useLocalSearchParams } from 'expo-router';
import { ServiceDetailScreen } from '@/features/services/detail';
import { useI18n } from '@/i18n';
import { isSafeId } from '@/lib/deep-links';
import { EmptyState, FeatureGate } from '@/ui/states';

export default function ServiceRoute() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <FeatureGate feature="services" label={t('tab.services')}>
      {isSafeId(id) ? <ServiceDetailScreen id={id} /> : <EmptyState icon="alert-circle-outline" title={t('services.notFound')} />}
    </FeatureGate>
  );
}
