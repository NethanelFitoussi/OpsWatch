import { useLocalSearchParams } from 'expo-router';
import { InfraDetailScreen } from '@/features/infrastructure/detail';
import { useI18n } from '@/i18n';
import { isSafeId } from '@/lib/deep-links';
import { EmptyState, FeatureGate } from '@/ui/states';

export default function InfrastructureResourceRoute() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <FeatureGate feature="infrastructure" label={t('nav.infrastructure')}>
      {isSafeId(id) ? <InfraDetailScreen id={id} /> : <EmptyState icon="alert-circle-outline" title={t('infrastructure.notFound')} />}
    </FeatureGate>
  );
}
