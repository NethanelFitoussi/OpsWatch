import { getTranslations } from 'next-intl/server';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { PageBody } from '@/components/page-body';
import { PageHeader } from '@/components/page-header';
import { localizedTitle } from '@/i18n/metadata';
import { initProtectedRoute } from '@/lib/auth/route';
import { readCloudflareConnection } from '@/lib/cloudflare/connection';
import { getDb } from '@/lib/db/client';
import {
  discoverZonesAction,
  removeCloudflareAction,
  saveCloudflareTokenAction,
  saveZonesAction,
  testCloudflareAction,
} from './actions';
import { CloudflareForm } from './cloudflare-form';

type Props = { params: Promise<{ locale: string }> };

export const dynamic = 'force-dynamic';
export const generateMetadata = localizedTitle('Settings.cloudflare.title');

/**
 * Connecting Cloudflare (§20, CF-1).
 *
 * Read-only, and scoped twice over: the token an operator creates carries the permissions they choose, and
 * OpsWatch then reads only the zones they pick here. A token that can see forty zones does not mean forty
 * zones on a page — that would put somebody else's traffic in front of a reader who never asked for it,
 * and would cost requests nobody agreed to.
 *
 * The token is encrypted under its own derivation and never returned to this browser.
 */
export default async function CloudflareSettingsPage({ params }: Props) {
  const { locale } = await initProtectedRoute(params);
  const t = await getTranslations('Settings.cloudflare');
  const connection = readCloudflareConnection(getDb());

  return (
    <PageBody>
      <PageHeader title={t('title')} description={t('description')} />

      <MonitoringCard title={t('access')}>
        <p className="text-sm text-muted-foreground">{t('accessHint')}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{t('scope.read')}</li>
          <li>{t('scope.zones')}</li>
          <li>{t('scope.noWrites')}</li>
        </ul>
      </MonitoringCard>

      <CloudflareForm
        save={saveCloudflareTokenAction.bind(null, locale)}
        test={testCloudflareAction.bind(null, locale)}
        discover={discoverZonesAction.bind(null, locale)}
        saveZones={saveZonesAction.bind(null, locale)}
        remove={removeCloudflareAction.bind(null, locale)}
        current={connection}
      />
    </PageBody>
  );
}
