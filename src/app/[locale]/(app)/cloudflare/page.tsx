import { getFormatter, getTranslations } from 'next-intl/server';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { PageBody } from '@/components/page-body';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { localizedTitle } from '@/i18n/metadata';
import { Link } from '@/i18n/navigation';
import { initProtectedRoute } from '@/lib/auth/route';
import { getDb } from '@/lib/db/client';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { readCloudflareOverview } from '@/lib/read/cloudflare';
import { ZoneCard } from './zone-cards';

type Props = { params: Promise<{ locale: string }> };

export const dynamic = 'force-dynamic';
export const generateMetadata = localizedTitle('Monitoring.cloudflare.title');

/**
 * What the edge saw (CF-2).
 *
 * The page that answers "what did connecting Cloudflare actually buy me". Every figure is a count
 * Cloudflare reported or a ratio of two of them, read from stored rows — so opening it costs nothing and
 * answers the same way twice.
 *
 * **Instance-scoped**, not per AWS environment: a zone belongs to the installation. And four different
 * emptinesses, kept apart, because each needs a different thing from the operator: not connected, saved
 * but unverified, verified but watching nothing, and watching but not read yet.
 */
export default async function CloudflarePage({ params }: Props) {
  await initProtectedRoute(params);
  const t = await getTranslations('Monitoring.cloudflare');
  const format = await getFormatter();
  const overview = readCloudflareOverview(getDb(), pageNow());
  const percent = (value: number | null) => (value === null ? t('noRatio') : t('percent', { value: Number((value * 100).toFixed(2)) }));

  return (
    <PageBody>
      <PageHeader title={t('title')} description={t('description')} />

      {overview.state !== 'ready' ? (
        <MonitoringCard title={t(`empty.${overview.state}.title`)}>
          <p className="text-sm">{t(`empty.${overview.state}.body`)}</p>
          <Button asChild className="mt-4" variant={overview.state === 'no_data' ? 'outline' : 'default'}>
            <Link href="/settings/cloudflare">{t(`empty.${overview.state}.action`)}</Link>
          </Button>
        </MonitoringCard>
      ) : (
        <>
          <MonitoringCard title={t('across')} description={t('acrossDescription', { zones: overview.zones.length })}>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">{t('requests')}</dt>
                <dd className="mt-0.5 text-xl font-semibold tabular-nums">{format.number(overview.totals.requests)}</dd>
              </div>
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">{t('cacheHit')}</dt>
                <dd className="mt-0.5 text-xl font-semibold tabular-nums">{percent(overview.totals.cacheHitRate)}</dd>
              </div>
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">{t('serverErrors')}</dt>
                <dd className="mt-0.5 text-xl font-semibold tabular-nums">{percent(overview.totals.serverErrorRate)}</dd>
              </div>
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">{t('threats')}</dt>
                <dd className="mt-0.5 text-xl font-semibold tabular-nums">{format.number(overview.totals.threats)}</dd>
              </div>
            </dl>
            {/* Where the numbers come from, in one line rather than a paragraph. */}
            <p className="mt-3 text-xs text-muted-foreground">{t('provenance')}</p>
          </MonitoringCard>

          {overview.zones.map((zone) => (
            <ZoneCard key={zone.id} zone={zone} />
          ))}
        </>
      )}
    </PageBody>
  );
}
