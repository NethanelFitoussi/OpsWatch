import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { MonitoringFailure } from '@/lib/monitoring/result';
import { permissionsPath } from '@/lib/monitoring/shared/paths';
import { TONE_BORDER } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

/** Why a card has no data: a missing permission (with a link to the test), throttling or another AWS error. */
export async function FailureNotice({ failure, connectionId }: { failure: MonitoringFailure; connectionId: string }) {
  const t = await getTranslations('Monitoring.common.failure');
  return (
    <div role="status" className={cn('rounded-md border p-3 text-sm', TONE_BORDER.warning)}>
      {failure.reason === 'denied' && (
        <>
          {t('denied', { action: failure.action })}{' '}
          <Link href={permissionsPath(connectionId)} className="font-medium text-primary underline-offset-4 hover:underline">
            {t('openChecklist')}
          </Link>
        </>
      )}
      {failure.reason === 'throttled' && t('throttled')}
      {failure.reason === 'error' && t('error', { code: failure.code })}
    </div>
  );
}
