import { getTranslations } from 'next-intl/server';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { PageBody } from '@/components/page-body';
import { PageHeader } from '@/components/page-header';
import { Link } from '@/i18n/navigation';
import { localizedTitle } from '@/i18n/metadata';
import { initProtectedRoute } from '@/lib/auth/route';
import { getDb } from '@/lib/db/client';
import { integrationStatuses } from '@/lib/integrations/status';

type Props = { params: Promise<{ locale: string }> };

export const dynamic = 'force-dynamic';
export const generateMetadata = localizedTitle('Settings.integrations.title');

/**
 * Everything OpsWatch can be connected to, in one place (§E, UX-9).
 *
 * Three things this page has to make obvious before anybody decides anything: **what each integration
 * enables**, **what access OpsWatch is being given**, and **whether it is actually working**. A card that
 * says "Connect GitHub" without the second is asking for a decision nobody has the information to make.
 *
 * Every state is measured. A settings page existing is not a connection, and a stored credential is not a
 * working one — `Saved, not tested` is a state of its own, and so is `Not available in this build`.
 */
export default async function IntegrationsPage({ params }: Props) {
  await initProtectedRoute(params);
  const t = await getTranslations('Settings.integrations');
  const statuses = integrationStatuses(getDb());

  return (
    <PageBody>
      <PageHeader title={t('title')} description={t('description')} />

      <MonitoringCard title={t('readOnly')}>
        <p className="text-sm text-muted-foreground">{t('readOnlyHint')}</p>
      </MonitoringCard>

      <ul className="flex flex-col gap-3">
        {statuses.map((status) => (
          <li key={status.id}>
            <MonitoringCard title={t(`names.${status.id}`)}>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tracking-wide uppercase">{t(`states.${status.state}`)}</span>
                {status.detailKey !== null && (
                  <span className="text-sm text-muted-foreground">{t(`detail.${status.detailKey}`, status.values)}</span>
                )}
              </div>

              <p className="mt-2 text-sm">{t(`enables.${status.id}`)}</p>
              {/* What OpsWatch is allowed to do with the connection, beside the button that creates it. */}
              <p className="mt-1 text-sm text-muted-foreground">{t(`access.${status.id}`)}</p>

              {status.href !== null && (
                <p className="mt-2">
                  <Link href={status.href} className="text-sm font-medium underline-offset-4 hover:underline">
                    {status.state === 'not_configured' ? t('configure') : t('manage')}
                  </Link>
                </p>
              )}
            </MonitoringCard>
          </li>
        ))}
      </ul>
    </PageBody>
  );
}
