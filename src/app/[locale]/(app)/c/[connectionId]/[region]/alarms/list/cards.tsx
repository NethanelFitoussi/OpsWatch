import { getFormatter, getTranslations } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FailureNotice } from '@/components/monitoring/failure-notice';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { Link } from '@/i18n/navigation';
import { COMPARISON_SYMBOLS, filterAlarms, listAlarms, type AlarmFilter, type AlarmState } from '@/lib/monitoring/alarms';
import type { MonitoringScope } from '@/lib/monitoring/call';
import { subsectionPath } from '@/lib/monitoring/shared/paths';
import { resolveTarget } from '@/lib/monitoring/target';
import { TONE_SOFT } from '@/lib/ui/tones';

const STATE_BADGE_CLASS: Record<AlarmState, string> = {
  ALARM: TONE_SOFT.danger,
  INSUFFICIENT_DATA: 'bg-muted text-muted-foreground',
  OK: TONE_SOFT.success,
};

export async function AlarmsCard({ scope, filter }: { scope: MonitoringScope; filter: AlarmFilter }) {
  const t = await getTranslations('Monitoring.alarms');
  const target = await resolveTarget(scope);
  if (!target.ok) {
    return (
      <MonitoringCard title={t('cardTitle')}>
        <FailureNotice failure={target} connectionId={scope.connectionId} />
      </MonitoringCard>
    );
  }

  const alarms = await listAlarms(target.data);
  if (!alarms.ok) {
    return (
      <MonitoringCard title={t('cardTitle')}>
        <FailureNotice failure={alarms} connectionId={scope.connectionId} />
      </MonitoringCard>
    );
  }

  const format = await getFormatter();
  const rows = filterAlarms(alarms.data, filter);
  const hidden = filter.showTargetTracking
    ? 0
    : alarms.data.filter((a) => a.targetTracking && (filter.state === 'all' || a.state === filter.state)).length;

  const hiddenHref = () => {
    const params = new URLSearchParams({ tt: '1', state: filter.state });
    if (filter.search) params.set('q', filter.search);
    return `${subsectionPath(scope, 'alarms', 'list')}?${params.toString()}`;
  };

  return (
    <MonitoringCard title={t('cardTitle')}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.state')}</TableHead>
              <TableHead>{t('columns.name')}</TableHead>
              <TableHead>{t('columns.metric')}</TableHead>
              <TableHead>{t('columns.threshold')}</TableHead>
              <TableHead>{t('columns.updated')}</TableHead>
              <TableHead>{t('columns.reason')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((alarm) => (
              <TableRow key={alarm.name}>
                <TableCell>
                  <Badge className={STATE_BADGE_CLASS[alarm.state]}>{t(`filters.states.${alarm.state}`)}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs break-all">{alarm.name}</TableCell>
                <TableCell>
                  {alarm.type === 'composite' ? t('composite') : alarm.metricName ? `${alarm.namespace} · ${alarm.metricName}` : t('metricMath')}
                </TableCell>
                <TableCell>
                  {alarm.threshold != null ? `${COMPARISON_SYMBOLS[alarm.comparison ?? ''] ?? alarm.comparison} ${alarm.threshold}` : '—'}
                </TableCell>
                <TableCell>{alarm.stateUpdatedAt != null ? format.relativeTime(alarm.stateUpdatedAt) : '—'}</TableCell>
                <TableCell className="max-w-xs truncate" title={alarm.stateReason}>
                  {alarm.stateReason}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {hidden > 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          {t('hiddenTargetTracking', { count: hidden })}{' '}
          <Link href={hiddenHref()} className="font-medium text-primary underline-offset-4 hover:underline">
            {t('showHidden')}
          </Link>
        </p>
      )}
    </MonitoringCard>
  );
}
