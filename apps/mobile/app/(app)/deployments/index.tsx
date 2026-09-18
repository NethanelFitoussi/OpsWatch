import { useDeployments } from '@/api/queries';
import { DeploymentRow } from '@/features/deployments/components';
import { useI18n } from '@/i18n';
import { InfiniteListScreen } from '@/ui/list-screen';
import { FeatureGate } from '@/ui/states';

export default function DeploymentsScreen() {
  const { t } = useI18n();
  const deployments = useDeployments();
  return (
    <FeatureGate feature="deployments" label={t('nav.deployments')}>
      <InfiniteListScreen
        query={deployments}
        testID="deployments-screen"
        keyExtractor={(d) => d.id}
        renderItem={({ item }) => <DeploymentRow deployment={item} />}
        empty={{ title: t('deployments.empty'), icon: 'rocket-outline' }}
      />
    </FeatureGate>
  );
}
