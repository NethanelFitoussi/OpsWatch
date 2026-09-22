import { useSystemStatus } from '@/api/queries';
import { isApiError } from '@/api/errors';
import { About, CollectorVerdict, Environments, Jobs } from '@/features/system/components';
import { useI18n } from '@/i18n';
import { EmptyState } from '@/ui/states';
import { QueryScreen, ScrollScreen } from '@/ui/screen';

/**
 * What OpsWatch knows about itself.
 *
 * The endpoint is administrator-only, so `forbidden` is an ordinary answer for an ordinary account — not a failure,
 * and not something to offer a retry for. It gets its own explanation rather than the generic permission error,
 * because the person reading it has done nothing wrong and the rest of the app works for them.
 */
export default function SystemScreen() {
  const { t } = useI18n();
  const query = useSystemStatus();

  if (isApiError(query.error) && query.error.kind === 'forbidden') {
    return (
      <ScrollScreen testID="system-screen">
        <EmptyState icon="lock-closed-outline" title={t('system.forbidden')} body={t('system.forbiddenBody')} />
      </ScrollScreen>
    );
  }

  return (
    <QueryScreen query={query} testID="system-screen">
      {(status) => (
        <>
          <CollectorVerdict status={status} />
          <Jobs jobs={status.jobs} />
          <Environments environments={status.environments} />
          <About status={status} />
        </>
      )}
    </QueryScreen>
  );
}
