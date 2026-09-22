import { useLocalSearchParams } from 'expo-router';
import { NotFoundState } from '@/ui/rows';
import { SyntheticDetailView } from '@/features/synthetics/detail';
import { useI18n } from '@/i18n';
import { isSafeId } from '@/lib/deep-links';
import { FeatureGate } from '@/ui/states';

export default function SyntheticScreen() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  return <FeatureGate feature="synthetics" label={t('nav.synthetics')}>{isSafeId(id) ? <SyntheticDetailView id={id} /> : <NotFoundState />}</FeatureGate>;
}
