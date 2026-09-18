import { useLocalSearchParams } from 'expo-router';
import { DeploymentDetailScreen } from '@/features/deployments/detail';
import { useI18n } from '@/i18n';
import { isSafeId } from '@/lib/deep-links';
import { EmptyState, FeatureGate } from '@/ui/states';

export default function DeploymentRoute() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <FeatureGate feature="deployments" label={t('nav.deployments')}>
      {isSafeId(id) ? <DeploymentDetailScreen id={id} /> : <EmptyState icon="alert-circle-outline" title={t('deployments.notFound')} />}
    </FeatureGate>
  );
}
