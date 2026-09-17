import { getFormatter, getTranslations } from 'next-intl/server';
import { FailureNotice } from '@/components/monitoring/failure-notice';
import { InsightList } from '@/components/monitoring/insight-list';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { Link } from '@/i18n/navigation';
import type { MonitoringScope } from '@/lib/monitoring/call';
import { sortInsights, type InsightSeverity } from '@/lib/monitoring/insights';
import { INSIGHT_FAMILIES, loadFamily, type InsightFamily } from '@/lib/monitoring/overview';
import { monitoringPath, type MonitoringSection } from '@/lib/monitoring/shared/paths';
import { resolveTarget } from '@/lib/monitoring/target';
import { TONE_BORDER } from '@/lib/ui/tones';

const SECTION: Record<InsightFamily, MonitoringSection> = { ecs: 'containers', rds: 'databases', alb: 'load-balancers', alarms: 'alarms' };
const NAV_KEY: Record<InsightFamily, string> = { ecs: 'containers', rds: 'databases', alb: 'loadBalancers', alarms: 'alarms' };
const SEVERITY_BORDER: Partial<Record<InsightSeverity, string>> = { critical: TONE_BORDER.danger, warning: TONE_BORDER.warning };

export async function SummaryCard({ scope, family, nowMs }: { scope: MonitoringScope; family: InsightFamily; nowMs: number }) {
  const t = await getTranslations('Monitoring.overview');
  const title = t(`summary.${family}.title`);

  const target = await resolveTarget(scope);
  if (!target.ok) {
    return (
      <MonitoringCard title={title}>
        <FailureNotice failure={target} connectionId={scope.connectionId} />
      </MonitoringCard>
    );
  }

  const result = await loadFamily(family, target.data, nowMs);
  if (!result.ok) {
    return (
      <MonitoringCard title={title}>
        <FailureNotice failure={result} connectionId={scope.connectionId} />
      </MonitoringCard>
    );
  }

  const { insights, affected, total } = result.data;
  // The card border carries the worst insight of the family, so a glance over the row is enough.
  const worst = insights.find((i) => i.severity === 'critical') ?? insights.find((i) => i.severity === 'warning');
  return (
    <MonitoringCard title={title} description={t('summary.window')} className={worst && SEVERITY_BORDER[worst.severity]}>
      <p className="text-2xl font-semibold">{t(`summary.${family}.value`, { affected, total })}</p>
      <Link href={monitoringPath(scope, SECTION[family])} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
        {t('summary.open')}
      </Link>
    </MonitoringCard>
  );
}

export async function InsightsCard({ scope, nowMs }: { scope: MonitoringScope; nowMs: number }) {
  const t = await getTranslations('Monitoring.overview');
  const tNav = await getTranslations('Common.nav');
  const format = await getFormatter();
  const title = t('insights.title');

  const target = await resolveTarget(scope);
  if (!target.ok) {
    return (
      <MonitoringCard title={title}>
        <FailureNotice failure={target} connectionId={scope.connectionId} />
      </MonitoringCard>
    );
  }

  // Every family is loaded again here: the page's clock keeps the window identical, so the cache serves the summary cards' own calls.
  const results = await Promise.all(INSIGHT_FAMILIES.map((family) => loadFamily(family, target.data, nowMs)));
  const insights = sortInsights(results.flatMap((r) => (r.ok ? r.data.insights : [])));
  const unavailable = INSIGHT_FAMILIES.filter((_, index) => !results[index].ok);

  return (
    <MonitoringCard title={title} description={t('insights.description')}>
      {unavailable.length > 0 && (
        <p className="mb-3 text-sm text-muted-foreground">
          {t('insights.unavailable', { families: format.list(unavailable.map((family) => tNav(NAV_KEY[family])), { type: 'conjunction' }) })}
        </p>
      )}
      {insights.length > 0 ? (
        <InsightList insights={insights} />
      ) : (
        unavailable.length === 0 && <p className="text-sm text-muted-foreground">{t('insights.none')}</p>
      )}
    </MonitoringCard>
  );
}
