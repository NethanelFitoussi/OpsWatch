import { useLocalSearchParams } from 'expo-router';
import { NotFoundState } from '@/ui/rows';
import { SloDetailView } from '@/features/slos/detail';
import { useI18n } from '@/i18n';
import { isSafeId } from '@/lib/deep-links';
import { FeatureGate } from '@/ui/states';

export default function SloScreen() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  return <FeatureGate feature="slos" label={t('nav.slos')}>{isSafeId(id) ? <SloDetailView id={id} /> : <NotFoundState />}</FeatureGate>;
}
