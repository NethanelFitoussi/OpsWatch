import { useCheckup } from '@/api/queries';
import { CheckupBody } from '@/features/checkup/components';
import { useI18n } from '@/i18n';
import { QueryScreen } from '@/ui/screen';
import { FeatureGate } from '@/ui/states';

/** Findings about how this environment is set up. Gated: a server that does not run checks says so. */
export default function CheckupScreen() {
  const { t } = useI18n();
  const query = useCheckup();

  return (
    <FeatureGate feature="checkup" label={t('nav.checkup')}>
      <QueryScreen query={query} testID="checkup-screen">
        {(checkup) => <CheckupBody checkup={checkup} />}
      </QueryScreen>
    </FeatureGate>
  );
}
