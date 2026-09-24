import { NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { REPORT_PERIODS, reportSchema, type Report, type ReportPeriod } from '@opswatch/contract';
import { markdownFilename } from '@/lib/analysis/markdown';
import { apiFailure, apiJson } from '@/lib/api/v1/envelope';
import { resolveEnvironment } from '@/lib/api/v1/environment';
import { apiRoute } from '@/lib/api/v1/handler';
import { resolveLocale } from '@/i18n/routing';
import { reportMarkdown } from '@/lib/read/report-markdown';
import { isReportSection, readReport } from '@/lib/read/reports';

export const dynamic = 'force-dynamic';

/**
 * `GET /api/v1/reports?section=&period=` (§19).
 *
 * A bounded object rather than a page: a report is a complete summary of one period, and half of one is not
 * a smaller report. Both parameters are validated against closed lists, so an unknown value is a stated
 * `invalid_request` rather than a report about nothing.
 */
/**
 * §19's Markdown export. It renders the very same report object the JSON answer carries, so what is pasted
 * into a ticket cannot disagree with what was on screen.
 */
async function asMarkdown(report: Report, url: URL, scope: string): Promise<NextResponse> {
  const locale = resolveLocale(url.searchParams.get('locale') ?? undefined);
  const t = await getTranslations({ locale, namespace: 'Monitoring.report' });
  const markdown = reportMarkdown(report, {
    title: (values) => `${t('title')}: ${String(values.section)}`,
    section: (id) => t(`sections.${id}`),
    figure: (id) => t(`figure.${id}`),
    unavailable: (reason) => t(`unavailable.${reason}`),
    period: (from, to) => new Date(from).toISOString() + ' – ' + new Date(to).toISOString(),
    columns: { name: t('columns.name'), value: t('columns.value'), previous: t('columns.previous'), change: t('columns.change') },
    notMeasured: t('notMeasured'),
  });

  return new NextResponse(markdown, {
    status: 200,
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      // Downloaded rather than rendered: the browser must never execute what a log line put in here.
      'content-disposition': `attachment; filename="${markdownFilename('opswatch-report', scope, report.period.to)}"`,
      'x-content-type-options': 'nosniff',
    },
  });
}

export const GET = apiRoute({
  handler: async ({ db, url }) => {
    const environment = resolveEnvironment(db, url);
    if (!environment.ok) return apiFailure(environment.error);

    // Closed lists, both of them: an unknown value is a stated error, never a report about nothing.
    const section = url.searchParams.get('section') ?? '';
    if (!isReportSection(section)) return apiFailure('invalid_request');

    const asked = url.searchParams.get('period') ?? '7d';
    if (!(REPORT_PERIODS as readonly string[]).includes(asked)) return apiFailure('invalid_request');

    // The machine-readable answer keeps the raw family ids: a client that wants words has the catalogue,
    // and a label in an API payload is a string nobody can join on.
    const report = readReport(
      db,
      { connectionId: environment.connectionId, scope: environment.scope, section, period: asked as ReportPeriod },
      { nowMs: Date.now() },
    );

    if (url.searchParams.get('format') === 'markdown') return asMarkdown(report, url, environment.scope);
    return apiJson(reportSchema, report);
  },
});
