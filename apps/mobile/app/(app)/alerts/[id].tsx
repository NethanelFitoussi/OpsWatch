import { useLocalSearchParams } from 'expo-router';
import { AlertDetailView } from '@/features/alerts/detail';
import { NotFoundState } from '@/ui/rows';
import { useI18n } from '@/i18n';
import { isSafeId } from '@/lib/deep-links';
import { FeatureGate } from '@/ui/states';

export default function AlertScreen() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  return <FeatureGate feature="alerts" label={t('tab.alerts')}>{isSafeId(id) ? <AlertDetailView id={id} /> : <NotFoundState />}</FeatureGate>;
}
