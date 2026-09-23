import { getTranslations } from 'next-intl/server';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { Link } from '@/i18n/navigation';
import { localizedTitle } from '@/i18n/metadata';
import { aiIsReady } from '@/lib/ai/connection';
import { getDb } from '@/lib/db/client';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { askAction } from './actions';
import { AskForm } from './ask-form';

type Props = { params: Promise<MonitoringParams> };

export const dynamic = 'force-dynamic';
export const generateMetadata = localizedTitle('Monitoring.ask.title');

/**
 * Ask OpsWatch (§23, AI-5).
 *
 * The page exists whether or not a provider is configured, and says which it is. That is deliberate: an
 * assistant that appears only once somebody has found the settings page is an assistant nobody finds, and
 * an assistant that pretends to be there when it is not is worse.
 *
 * What it answers from is the evidence the deterministic engine already computed — never a database dump,
 * never raw logs. The answer is rendered as the third of §7's bands: a hypothesis, beside its citations.
 */
export default async function AskPage({ params }: Props) {
  const context = await initMonitoringRoute(params);
  const t = await getTranslations('Monitoring.ask');
  const ready = aiIsReady(getDb());

  return (
    <SectionLayout context={context} section="overview" subsection="ask">
      <MonitoringCard title={t('title')} description={t('description')}>
        <p className="text-sm text-muted-foreground">{t('bands')}</p>
        {!ready && (
          <p className="mt-2 text-sm">
            {t('notConfigured')}{' '}
            <Link href="/settings/ai" className="font-medium underline-offset-4 hover:underline">
              {t('configure')}
            </Link>
          </p>
        )}
      </MonitoringCard>

      <AskForm
        ask={askAction.bind(null, context.locale, context.scope.connectionId, context.scope.region)}
        enabled={ready}
      />
    </SectionLayout>
  );
}
