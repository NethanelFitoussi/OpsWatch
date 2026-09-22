import { getFormatter, getTranslations } from 'next-intl/server';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { localizedTitle } from '@/i18n/metadata';
import { requireAdmin } from '@/lib/auth/current';
import { listConnections } from '@/lib/connections/repository';
import { getDb } from '@/lib/db/client';
import { HISTORY_CATEGORIES } from '@/lib/db/schema';
import { estimateMonthly, intervalComparison } from '@/lib/history/estimate';
import { readHistorySettings } from '@/lib/history/settings';
import { LIMITED_WITHOUT_HISTORY } from '@/lib/history/shared';
import { saveHistoryAction } from './actions';
import { HistoryForm } from './history-form';

type Props = { params: Promise<{ locale: string }> };

export const dynamic = 'force-dynamic';
export const generateMetadata = localizedTitle('Settings.history.title');

/**
 * Settings → Data & history (§31.1).
 *
 * The page exists to make one trade visible before it is made: history buys baselines, anomalies, SLOs and
 * reports, and costs AWS requests. So it states what is limited while it is off, and what enabling it would
 * cost — as two separately-billed lines (§33.12), never one blended number, and always called an estimate.
 */
export default async function HistorySettingsPage({ params }: Props) {
  const { locale } = await params;
  await requireAdmin(locale);
  const db = getDb();
  const t = await getTranslations('Settings.history');
  const format = await getFormatter();

  const settings = readHistorySettings(db);
  // Sized from what is actually discovered, not from a guess: §9.5's own arithmetic over this instance.
  const environments = listConnections(db).reduce((total, connection) => total + connection.regions.length, 0);
  const metricsPerCycle = Math.max(1, environments) * 258;
  const estimate = estimateMonthly({
    intervalMinutes: settings.intervalMinutes,
    metricCategories: [{ id: 'infrastructure', metricsPerCycle }],
    scanCategories: [],
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      </header>

      {!settings.enabled && (
        <MonitoringCard title={t('state.off')}>
          <p className="text-sm">{t('offExplained')}</p>
          <h2 className="mt-3 text-sm font-medium">{t('limited')}</h2>
          <ul className="mt-1 list-inside list-disc text-sm text-muted-foreground">
            {LIMITED_WITHOUT_HISTORY.map((limit) => (
              <li key={limit}>{t(`limits.${limit}`)}</li>
            ))}
          </ul>
        </MonitoringCard>
      )}

      <MonitoringCard title={t('estimate')}>
        {estimate.lines.map((line) => (
          <p key={line.unit} className="text-sm">
            {line.unit === 'metrics'
              ? t('lineMetrics', { metrics: format.number(line.metrics ?? 0) })
              : t('lineScanned', { gigabytes: format.number(Math.round(line.gigabytes ?? 0)) })}
            {' — '}
            {format.number(line.usd, { style: 'currency', currency: 'USD' })}
            {/* The volatile half is named, because averaging it into a total would hide it. */}
            {line.volatile && <span className="block text-xs text-muted-foreground">{t('volatile')}</span>}
          </p>
        ))}
        <p className="mt-2 text-sm font-medium">
          {t('total')}: {format.number(estimate.totalUsd, { style: 'currency', currency: 'USD' })}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{t('estimateCaveat')}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('intervalConsequence', {
            cycles: format.number(intervalComparison(metricsPerCycle, settings.intervalMinutes).cyclesPerMonth),
            metrics: format.number(intervalComparison(metricsPerCycle, settings.intervalMinutes).metricsPerMonth),
          })}
        </p>
      </MonitoringCard>

      <HistoryForm
        action={saveHistoryAction.bind(null, locale)}
        settings={{
          enabled: settings.enabled,
          intervalMinutes: settings.intervalMinutes,
          categories: settings.categories,
          retentionDays: settings.retentionDays,
          providerId: settings.providerId,
        }}
        categories={[...HISTORY_CATEGORIES]}
      />
    </div>
  );
}
