import { getTranslations } from 'next-intl/server';
import { ConnectionCard } from '@/components/connections/connection-card';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { PageBody } from '@/components/page-body';
import { PageHeader } from '@/components/page-header';
import { Link } from '@/i18n/navigation';
import { localizedTitle } from '@/i18n/metadata';
import { initProtectedRoute } from '@/lib/auth/route';
import { getDb } from '@/lib/db/client';
import { guidePath, hasGuide } from '@/lib/integrations/guides';
import { integrationStatuses } from '@/lib/integrations/status';
import { INTEGRATION_TONES } from '@/lib/integrations/tone';

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

      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {statuses.map((status) => (
          <li key={status.id}>
            <ConnectionCard
              integration={status.id}
              state={status.state}
              provider={t(`names.${status.id}`)}
              tone={INTEGRATION_TONES[status.state]}
              stateLabel={t(`states.${status.state}`)}
              title={t(`names.${status.id}`)}
              href={status.href}
              actionLabel={status.state === 'not_configured' ? t('configure') : t('manage')}
              notes={
                <>
                  {status.detailKey !== null && <p>{t(`detail.${status.detailKey}`, status.values)}</p>}
                  <p className="text-foreground">{t(`enables.${status.id}`)}</p>
                  {/* What OpsWatch is allowed to do with the connection, beside the way to change it. */}
                  <p className="text-xs">{t(`access.${status.id}`)}</p>
                </>
              }
              secondary={
                // The three entry points complement each other: manage here, learn there, add from Accounts.
                hasGuide(status.id) ? (
                  <Link href={guidePath(status.id)} className="underline-offset-4 hover:underline">
                    {t('readGuide')}
                  </Link>
                ) : undefined
              }
            />
          </li>
        ))}
      </ul>
    </PageBody>
  );
}
