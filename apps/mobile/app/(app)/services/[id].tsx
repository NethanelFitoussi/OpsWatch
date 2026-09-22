import { useLocalSearchParams } from 'expo-router';
import { ServiceDetailScreen } from '@/features/services/detail';
import { useI18n } from '@/i18n';
import { isSafeId } from '@/lib/deep-links';
import { NotFoundState } from '@/ui/rows';
import { FeatureGate } from '@/ui/states';

export default function ServiceRoute() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <FeatureGate feature="services" label={t('tab.services')}>
      {isSafeId(id) ? <ServiceDetailScreen id={id} /> : <NotFoundState title={t('services.notFound')} />}
    </FeatureGate>
  );
}
