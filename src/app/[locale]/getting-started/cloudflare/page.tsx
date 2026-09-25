import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { GuideLayout } from '@/components/getting-started/guide-layout';
import { IntegrationGuideBody } from '@/components/getting-started/integration-guide';
import { localizedTitle } from '@/i18n/metadata';
import { getCurrentAdminId } from '@/lib/auth/current';
import { getDb } from '@/lib/db/client';
import { GUIDE_CHAPTERS, setupPath } from '@/lib/integrations/guides';
import { integrationStatuses } from '@/lib/integrations/status';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }> };

export const generateMetadata = localizedTitle('GettingStarted.cloudflare.metaTitle');

/** The chain this guide exists to explain: token → verification → zones → what appears. */
const { steps: STEPS, failures: FAILURES } = GUIDE_CHAPTERS['cloudflare'];

export default async function CloudflareGuidePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('GettingStarted.cloudflare');
  const hub = await getTranslations('GettingStarted.hub');
  const signedIn = (await getCurrentAdminId()) !== null;
  const status = integrationStatuses(getDb()).find((one) => one.id === 'cloudflare');
  const state = status?.state ?? 'not_configured';

  return (
    <AppShell signedIn={signedIn}>
      <GuideLayout
        title={t('title')}
        subtitle={t('subtitle')}
        state={state}
        stateLabel={hub(`states.${state}`)}
        primary={{ href: setupPath('cloudflare'), label: t(state === 'connected' ? 'manageCta' : 'cta') }}
        secondary={{ href: '/getting-started', label: hub('backToGuides') }}
      >
        <IntegrationGuideBody namespace="GettingStarted.cloudflare" chain={{ count: 4, label: t('chainLabel') }} steps={STEPS} failures={FAILURES} />
      </GuideLayout>
    </AppShell>
  );
}
