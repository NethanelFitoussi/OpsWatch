import { getFormatter, getTranslations } from 'next-intl/server';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { SeverityBadge } from '@/components/problems/severity-badge';
import { localizedTitle } from '@/i18n/metadata';
import { getDb } from '@/lib/db/client';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { alertLabels } from '@/lib/read/alert-labels';
import { listAlertSummaries } from '@/lib/read/alerts';
import { hasBeenRead } from '@/lib/read/health';
import { listRules } from '@/lib/store/alerts';
import { acknowledgeAlertAction, toggleRuleAction } from './actions';
import { AlertControls } from './alert-controls';

type Props = { params: Promise<MonitoringParams> };

export const dynamic = 'force-dynamic';
export const generateMetadata = localizedTitle('Monitoring.alerts.title');

/**
 * Alerts (§15).
 *
 * Two things this page has to say that a list of rows does not say by itself: that nothing is sent outside
 * this instance, and how many fires the cooldown swallowed. The second is §15.2's whole point — an alert
 * that fired forty times and announced itself once is not the same as one that fired once.
 */
export default async function AlertsPage({ params }: Props) {
  const context = await initMonitoringRoute(params);
  const db = getDb();
  const t = await getTranslations('Monitoring.alerts');
  const tSeverity = await getTranslations('Insights.severity');
  const format = await getFormatter();
  const query = { connectionId: context.scope.connectionId, scope: context.scope.region };
  const nowMs = pageNow();

  const alerts = listAlertSummaries(db, query, await alertLabels(context.locale));
  const rules = listRules(db, query.connectionId, query.scope);
  const read = hasBeenRead(db, query);

  return (
    <SectionLayout context={context} section="overview" subsection="alerts">
      <MonitoringCard title={t('title')} description={t('description')}>
        {/* §15's promise, on the page rather than in documentation. */}
        <p className="text-sm text-muted-foreground">{t('inAppOnly')}</p>
      </MonitoringCard>

      <MonitoringCard title={t('active')}>
        {alerts.length === 0 ? (
          <>
            <p className="text-sm">{read ? t('none') : t('waiting')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{read ? t('noneHint') : t('waitingHint')}</p>
          </>
        ) : (
          <ul className="divide-y">
            {alerts.map((alert) => (
              <li key={alert.id} className="py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <SeverityBadge severity={alert.severity} label={tSeverity(alert.severity)} />
                  <span className="text-sm font-medium">{alert.name}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tracking-wide uppercase">
                    {t(`status.${alert.status}`)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {alert.since !== null && t('since', { when: format.relativeTime(new Date(alert.since), new Date(nowMs)) })}
                  {/* How much quiet there was, so the silence is accounted for rather than assumed. */}
                  {alert.reason !== undefined && ` · ${alert.reason}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </MonitoringCard>

      <MonitoringCard title={t('manage')}>
        <AlertControls
          acknowledge={acknowledgeAlertAction.bind(null, context.locale, query.connectionId, query.scope)}
          toggle={toggleRuleAction.bind(null, context.locale, query.connectionId, query.scope)}
          alerts={alerts.map((alert) => ({
            id: alert.id,
            name: alert.name,
            // Only a firing, unacknowledged alert can be acknowledged; the rest have nothing to silence.
            canAcknowledge: alert.status === 'firing',
          }))}
          rules={rules.map((rule) => ({
            id: rule.id,
            name: rule.name,
            enabled: rule.enabled,
            cooldownMinutes: Math.round(rule.cooldownSeconds / 60),
          }))}
        />
      </MonitoringCard>
    </SectionLayout>
  );
}
