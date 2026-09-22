import { getFormatter, getTranslations } from 'next-intl/server';
import { REPORT_PERIODS, type Report, type ReportPeriod, type ReportSection } from '@opswatch/contract';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { SeverityBadge } from '@/components/problems/severity-badge';
import { Link } from '@/i18n/navigation';

/**
 * A report, rendered. One component for all four sections, because a report differs only in what it covers.
 *
 * The rule it exists to keep is §2.6's: a section that could not be answered renders **its reason in words**,
 * never an empty table and never a zero. An operator must be able to tell "nothing went wrong this week"
 * from "OpsWatch was not collecting the data that would have shown it".
 */

/** A change, signed and coloured by whether more of this thing is worse. */
function Delta({ delta, notMeasured }: { delta: number | null; notMeasured: string }) {
  if (delta === null) return <span className="text-muted-foreground">{notMeasured}</span>;
  if (delta === 0) return <span className="text-muted-foreground">0</span>;
  const rounded = Number.isInteger(delta) ? String(delta) : delta.toFixed(1);
  return (
    <span className={delta > 0 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'}>
      {delta > 0 ? `+${rounded}` : rounded}
    </span>
  );
}

function Value({ value, notMeasured }: { value: number | null; notMeasured: string }) {
  if (value === null) return <span className="text-muted-foreground">{notMeasured}</span>;
  return <>{Number.isInteger(value) ? value : value.toFixed(1)}</>;
}

export async function ReportView({
  report,
  locale,
  basePath,
  exportHref,
}: {
  report: Report;
  locale: string;
  /** The report's own path, so the period links stay on this page. */
  basePath: string;
  /** Where the Markdown copy of this exact report comes from. */
  exportHref: string;
}) {
  const t = await getTranslations({ locale, namespace: 'Monitoring.report' });
  const tSeverity = await getTranslations({ locale, namespace: 'Insights.severity' });
  const format = await getFormatter({ locale });
  const notMeasured = t('notMeasured');
  const when = (at: number) => format.dateTime(new Date(at), { dateStyle: 'medium', timeStyle: 'short' });

  const body = (section: ReportSection) => {
    if (section.unavailable !== null) {
      return (
        <div>
          <p className="text-sm">{t(`unavailable.${section.unavailable}`)}</p>
          {section.unavailable === 'history_off' && (
            <Link href="/settings/history" className="mt-2 inline-block text-sm underline underline-offset-4">
              {t('turnOnHistory')}
            </Link>
          )}
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-4 font-medium">{t('columns.name')}</th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">{t('columns.value')}</th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">{t('columns.previous')}</th>
              <th scope="col" className="py-2 text-right font-medium">{t('columns.change')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {section.figures.map((item) => (
              <tr key={item.id}>
                <th scope="row" className="py-2 pr-4 text-left font-normal">
                  <span className="flex items-center gap-2">
                    {t(`figure.${item.id}`)}
                    {item.severity !== undefined && <SeverityBadge severity={item.severity} label={tSeverity(item.severity)} />}
                  </span>
                </th>
                <td className="py-2 pr-4 text-right tabular-nums"><Value value={item.value} notMeasured={notMeasured} /></td>
                <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground"><Value value={item.previous} notMeasured={notMeasured} /></td>
                <td className="py-2 text-right tabular-nums"><Delta delta={item.delta} notMeasured={notMeasured} /></td>
              </tr>
            ))}
            {section.rows.map((row) => (
              <tr key={row.id}>
                <th scope="row" className="max-w-md truncate py-2 pr-4 text-left font-normal" title={row.label}>{row.label}</th>
                <td className="py-2 pr-4 text-right tabular-nums"><Value value={row.value} notMeasured={notMeasured} /></td>
                <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground"><Value value={row.previous} notMeasured={notMeasured} /></td>
                <td className="py-2 text-right tabular-nums"><Delta delta={row.delta} notMeasured={notMeasured} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* §19 asks for this sentence wherever the bucket approximation is shown, rather than in a footnote. */}
        {section.id === 'availability' && <p className="mt-2 text-xs text-muted-foreground">{t('approximation')}</p>}
      </div>
    );
  };

  return (
    <>
      <MonitoringCard title={t('title')} description={t('description')}>
        <p className="text-sm">{t('period', { from: when(report.period.from), to: when(report.period.to) })}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('comparedWith', { from: when(report.previousPeriod.from), to: when(report.previousPeriod.to) })}
        </p>
        <nav aria-label={t('choosePeriod')} className="mt-3 flex flex-wrap items-center gap-2">
          {REPORT_PERIODS.map((period: ReportPeriod) => (
            <Link
              key={period}
              href={`${basePath}?period=${period}`}
              aria-current={period === report.period.id ? 'page' : undefined}
              className={`rounded-md border px-2 py-1 text-xs ${period === report.period.id ? 'bg-muted font-medium' : 'hover:bg-muted'}`}
            >
              {t(`periods.${period}`)}
            </Link>
          ))}
          {/* §19: the same report, exportable. It downloads rather than renders, so nothing a log line put
              in an error message is ever executed by the browser. */}
          <a
            href={exportHref}
            download
            className="ml-auto rounded-md border px-2 py-1 text-xs hover:bg-muted"
          >
            {t('export')}
          </a>
        </nav>
      </MonitoringCard>

      {report.sections.map((section) => (
        <MonitoringCard key={section.id} title={t(`sections.${section.id}`)}>
          {body(section)}
        </MonitoringCard>
      ))}
    </>
  );
}
