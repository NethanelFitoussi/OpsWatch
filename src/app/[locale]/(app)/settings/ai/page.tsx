import { getTranslations } from 'next-intl/server';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { PageBody } from '@/components/page-body';
import { PageHeader } from '@/components/page-header';
import { localizedTitle } from '@/i18n/metadata';
import { aiHasCredential, readAiConnection } from '@/lib/ai/connection';
import { initProtectedRoute } from '@/lib/auth/route';
import { getDb } from '@/lib/db/client';
import { removeAiAction, saveAiAction, testAiAction } from './actions';
import { AiForm } from './ai-form';

type Props = { params: Promise<{ locale: string }> };

export const dynamic = 'force-dynamic';
export const generateMetadata = localizedTitle('Settings.ai.title');

/**
 * The optional AI provider (AI-2, AI-3).
 *
 * **Off by default, and OpsWatch is whole without it.** §2.2 is the ruling this page exists under:
 * grouping, severity, baselines and anomalies are computed by written formulas and unit-tested; AI ranks
 * and narrates, and it never decides. Nothing on any other page stops working because nobody configured a
 * provider — and the page says so before it asks for a key.
 *
 * The key is encrypted under its own derivation and never sent back to the browser. The field is always
 * empty; leaving it so keeps whatever is stored.
 */
export default async function AiSettingsPage({ params }: Props) {
  const { locale } = await initProtectedRoute(params);
  const db = getDb();
  const t = await getTranslations('Settings.ai');
  const connection = readAiConnection(db);

  return (
    <PageBody>
      <PageHeader title={t('title')} description={t('description')} />

      <MonitoringCard title={t('boundaries')}>
        {/* The four bands, stated where somebody is about to turn AI on rather than in documentation. */}
        <p className="text-sm text-muted-foreground">{t('boundariesHint')}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{t('boundary.evidence')}</li>
          <li>{t('boundary.bounded')}</li>
          <li>{t('boundary.noWrites')}</li>
          <li>{t('boundary.optional')}</li>
        </ul>
      </MonitoringCard>

      <AiForm
        save={saveAiAction.bind(null, locale)}
        test={testAiAction.bind(null, locale)}
        remove={removeAiAction.bind(null, locale)}
        current={connection === null ? null : { ...connection, hasCredential: aiHasCredential(db) }}
      />
    </PageBody>
  );
}
