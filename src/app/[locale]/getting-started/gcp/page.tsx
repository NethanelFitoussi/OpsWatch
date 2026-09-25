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

export const generateMetadata = localizedTitle('GettingStarted.gcp.metaTitle');

/** The chain this guide exists to explain: a key → trust → two roles → short-lived tokens. */
const { steps: STEPS, failures: FAILURES } = GUIDE_CHAPTERS['gcp'];

export default async function GoogleCloudGuidePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('GettingStarted.gcp');
  const hub = await getTranslations('GettingStarted.hub');
  const signedIn = (await getCurrentAdminId()) !== null;
  const status = integrationStatuses(getDb()).find((one) => one.id === 'gcp');
  const state = status?.state ?? 'not_configured';

  return (
    <AppShell signedIn={signedIn}>
      <GuideLayout
        title={t('title')}
        subtitle={t('subtitle')}
        state={state}
        stateLabel={hub(`states.${state}`)}
        primary={{ href: setupPath('gcp'), label: t(state === 'connected' ? 'manageCta' : 'cta') }}
        secondary={{ href: '/getting-started', label: hub('backToGuides') }}
      >
        <IntegrationGuideBody namespace="GettingStarted.gcp" chain={{ count: 4, label: t('chainLabel') }} steps={STEPS} failures={FAILURES} />
      </GuideLayout>
    </AppShell>
  );
}
