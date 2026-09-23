import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { GuideLayout } from '@/components/getting-started/guide-layout';
import { IntegrationGuideBody } from '@/components/getting-started/integration-guide';
import { localizedTitle } from '@/i18n/metadata';
import { getCurrentAdminId } from '@/lib/auth/current';
import { getDb } from '@/lib/db/client';
import { setupPath } from '@/lib/integrations/guides';
import { integrationStatuses } from '@/lib/integrations/status';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }> };

export const generateMetadata = localizedTitle('GettingStarted.ai.metaTitle');

/** The four bands an answer is read in: observed evidence → correlations → hypothesis → what would settle it. */
const STEPS = ['choose', 'key', 'store', 'test', 'ask'] as const;
const FAILURES = ['unauthorized', 'rateLimited', 'refusedEndpoint', 'noEvidence', 'timeout'] as const;

export default async function AiGuidePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('GettingStarted.ai');
  const hub = await getTranslations('GettingStarted.hub');
  const signedIn = (await getCurrentAdminId()) !== null;
  const status = integrationStatuses(getDb()).find((one) => one.id === 'ai');
  const state = status?.state ?? 'not_configured';

  return (
    <AppShell signedIn={signedIn}>
      <GuideLayout
        title={t('title')}
        subtitle={t('subtitle')}
        state={state}
        stateLabel={hub(`states.${state}`)}
        primary={{ href: setupPath('ai'), label: t(state === 'connected' ? 'manageCta' : 'cta') }}
        secondary={{ href: '/getting-started', label: hub('backToGuides') }}
      >
        <IntegrationGuideBody namespace="GettingStarted.ai" chain={{ count: 4, label: t('chainLabel') }} steps={STEPS} failures={FAILURES} />
      </GuideLayout>
    </AppShell>
  );
}
