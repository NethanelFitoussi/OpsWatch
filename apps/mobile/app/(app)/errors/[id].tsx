import { Stack, useLocalSearchParams } from 'expo-router';
import { useErrorGroup } from '@/api/queries';
import { ErrorFacts, ErrorHeader, ErrorInstances, ErrorRelated, ErrorSampleLogs, ErrorStack } from '@/features/errors/detail';
import { useI18n } from '@/i18n';
import { isSafeId } from '@/lib/deep-links';
import { QueryScreen, ScrollScreen } from '@/ui/screen';
import { EmptyState, FeatureGate } from '@/ui/states';

function ErrorDetail({ id }: { id: string }) {
  const { t } = useI18n();
  const query = useErrorGroup(id);
  return (
    <QueryScreen query={query} testID="error-detail-screen">
      {(error) => (
        <>
          {/* What happened, how bad, where, the evidence, and last the objects to open next. */}
          <Stack.Screen options={{ title: error.type ?? t('nav.errors') }} />
          <ErrorHeader error={error} />
          <ErrorFacts error={error} />
          <ErrorStack error={error} />
          <ErrorSampleLogs error={error} />
          <ErrorInstances instances={error.instances} />
          <ErrorRelated error={error} />
        </>
      )}
    </QueryScreen>
  );
}

export default function ErrorDetailScreen() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <FeatureGate feature="errors" label={t('nav.errors')}>
      {isSafeId(id) ? (
        <ErrorDetail id={id} />
      ) : (
        <ScrollScreen>
          <EmptyState icon="help-circle-outline" title={t('error.not_found')} />
        </ScrollScreen>
      )}
    </FeatureGate>
  );
}
