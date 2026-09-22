import { getFormatter, getTranslations } from 'next-intl/server';
import { FailureNotice } from '@/components/monitoring/failure-notice';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { MonitoringScope } from '@/lib/monitoring/call';
import { loadLogVolume } from '@/lib/monitoring/log-volume';
import { timeWindow, type TimeRange } from '@/lib/monitoring/shared/time-range';
import { resolveTarget } from '@/lib/monitoring/target';

const GB = 1024 ** 3;
const MB = 1024 ** 2;

/** Bytes as something a person reads, or the words for "nobody measured this" (§2.4). */
function bytes(value: number | null, notMeasured: string): string {
  if (value === null) return notMeasured;
  if (value >= GB) return `${(value / GB).toFixed(2)} GB`;
  if (value >= MB) return `${(value / MB).toFixed(1)} MB`;
  return `${Math.round(value / 1024)} KB`;
}

export async function LogVolumeCard({ scope, range, nowMs }: { scope: MonitoringScope; range: TimeRange; nowMs: number }) {
  const t = await getTranslations('Monitoring.volume');
  const format = await getFormatter();
  const title = t('cardTitle');
  const notMeasured = t('notMeasured');

  const target = await resolveTarget(scope);
  if (!target.ok) {
    return (
      <MonitoringCard title={title}>
        <FailureNotice failure={target} connectionId={scope.connectionId} />
      </MonitoringCard>
    );
  }

  const volume = await loadLogVolume(target.data, timeWindow(range, nowMs));
  if (!volume.ok) {
    return (
      <MonitoringCard title={title}>
        <FailureNotice failure={volume} connectionId={scope.connectionId} />
      </MonitoringCard>
    );
  }

  const { groups, totalIngestedBytes, covered, truncated } = volume.data;
  if (groups.length === 0) {
    return (
      <MonitoringCard title={title}>
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      </MonitoringCard>
    );
  }

  const forever = groups.filter((group) => group.retentionDays === null).length;

  return (
    <MonitoringCard title={title} description={t('cardDescription')}>
      <p className="text-sm">
        {t('total', { total: bytes(totalIngestedBytes, notMeasured), groups: covered })}
      </p>
      {/* §2.4: a page that covered only part of the account says so rather than looking complete. */}
      {truncated && <p className="mt-1 text-sm text-muted-foreground">{t('truncated', { covered })}</p>}
      {forever > 0 && <p className="mt-1 text-sm">{t('foreverCount', { count: forever })}</p>}

      <div className="mt-3 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('group')}</TableHead>
              <TableHead className="text-right">{t('ingested')}</TableHead>
              <TableHead className="text-right">{t('share')}</TableHead>
              <TableHead className="text-right">{t('stored')}</TableHead>
              <TableHead className="text-right">{t('retention')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => (
              <TableRow key={group.name}>
                <TableCell className="max-w-xs break-all">{group.name}</TableCell>
                <TableCell className="text-right tabular-nums">{bytes(group.ingestedBytes, notMeasured)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {group.share === null ? notMeasured : format.number(group.share, { style: 'percent', maximumFractionDigits: 1 })}
                </TableCell>
                <TableCell className="text-right tabular-nums">{bytes(group.storedBytes, notMeasured)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {/* "Forever" is the answer that costs money, so it is words rather than a blank cell. */}
                  {group.retentionDays === null ? t('forever') : t('days', { days: group.retentionDays })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t('noQueryCost')}</p>
    </MonitoringCard>
  );
}
