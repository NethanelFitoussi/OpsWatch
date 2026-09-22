import { useLocalSearchParams } from 'expo-router';
import { NotFoundState } from '@/ui/rows';
import { IncidentDetailView } from '@/features/incidents/detail';
import { useI18n } from '@/i18n';
import { isSafeId } from '@/lib/deep-links';
import { FeatureGate } from '@/ui/states';

export default function IncidentScreen() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  return <FeatureGate feature="incidents" label={t('nav.incidents')}>{isSafeId(id) ? <IncidentDetailView id={id} /> : <NotFoundState />}</FeatureGate>;
}
