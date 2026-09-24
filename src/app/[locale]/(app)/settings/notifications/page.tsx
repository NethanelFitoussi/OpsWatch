import { getFormatter, getTranslations } from 'next-intl/server';
import { DocLink } from '@/components/docs/doc-link';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { PageBody } from '@/components/page-body';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/code-block';
import { localizedTitle } from '@/i18n/metadata';
import { initProtectedRoute } from '@/lib/auth/route';
import { getDb } from '@/lib/db/client';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from '@/lib/notify/payload';
import { listDestinations } from '@/lib/store/notifications';
import { STATE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';
import { createDestinationAction, deleteDestinationAction, testDestinationAction, toggleDestinationAction } from './actions';
import { CreateDestinationForm, TestDestinationForm } from './forms';

type Props = { params: Promise<{ locale: string }> };

export const generateMetadata = localizedTitle('Settings.notifications.title');

/**
 * Where an alert may be sent (§15, ALE-4).
 *
 * The page states what will be sent before anybody creates a destination, because "a webhook" is not
 * enough information to decide whether to point one at your systems. The example payload and the header
 * names are here, not only in the guide.
 */
export default async function NotificationsSettingsPage({ params }: Props) {
  const { locale } = await initProtectedRoute(params);
  const t = await getTranslations('Settings.notifications');
  const format = await getFormatter();
  const destinations = listDestinations(getDb());

  const example = JSON.stringify(
    {
      id: '9f2b1c4d5e6f',
      alertId: 'a1b2c3d4e5f6',
      kind: 'alert.fired',
      severity: 'critical',
      title: 'Insights.messages.alb_5xx_rate',
      subject: 'app/web/abc123',
      environment: '6d293fe0d4b3:eu-west-1',
      firedAt: 1790000000000,
      url: 'https://opswatch.example.com/c/6d293fe0d4b3/eu-west-1/overview/problems/0ef71e196306',
    },
    null,
    2,
  );

  return (
    <PageBody>
      <PageHeader title={t('title')} description={t('description')} />

      <MonitoringCard title={t('whatIsSent')} description={t('whatIsSentHint')}>
        <CodeBlock value={example} />
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex flex-wrap gap-2">
            <dt className="font-mono text-xs">{SIGNATURE_HEADER}</dt>
            <dd className="text-muted-foreground">{t('signatureHeader')}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="font-mono text-xs">{TIMESTAMP_HEADER}</dt>
            <dd className="text-muted-foreground">{t('timestampHeader')}</dd>
          </div>
        </dl>
        <p className="mt-3">
          <DocLink slug="alerts" label={t('readGuide')} />
        </p>
      </MonitoringCard>

      <MonitoringCard title={t('addTitle')} description={t('addHint')}>
        <CreateDestinationForm action={createDestinationAction.bind(null, locale)} />
      </MonitoringCard>

      <MonitoringCard title={t('listTitle')}>
        {destinations.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('none')}</p>
        ) : (
          <ul className="divide-y">
            {destinations.map((destination) => (
              <li key={destination.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-medium">{destination.name}</span>
                  <span className={cn('text-sm', destination.enabled ? '' : 'text-muted-foreground')}>
                    {destination.enabled ? t('enabled') : t('disabled')}
                  </span>
                </div>
                <p className="font-mono text-xs break-all text-muted-foreground">{destination.url}</p>
                {/* What happened last time, so a destination that quietly stopped working is visible. */}
                <p className="text-sm">
                  {destination.lastResult === null ? (
                    <span className="text-muted-foreground">{t('neverSent')}</span>
                  ) : (
                    <span className={cn(destination.lastResult === 'ok' ? STATE_TEXT.healthy : STATE_TEXT.critical)}>
                      {destination.lastResult === 'ok'
                        ? t('lastOk', { when: format.relativeTime(new Date(destination.lastAttemptAt ?? 0)) })
                        : t('lastFailed', { when: format.relativeTime(new Date(destination.lastAttemptAt ?? 0)), failures: destination.consecutiveFailures })}
                    </span>
                  )}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <TestDestinationForm action={testDestinationAction.bind(null, locale, destination.id)} />
                  <form action={toggleDestinationAction.bind(null, locale, destination.id, !destination.enabled)}>
                    <Button type="submit" variant="outline" size="sm">
                      {destination.enabled ? t('disable') : t('enable')}
                    </Button>
                  </form>
                  <form action={deleteDestinationAction.bind(null, locale, destination.id)}>
                    <Button type="submit" variant="outline" size="sm">
                      {t('delete')}
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </MonitoringCard>
    </PageBody>
  );
}
