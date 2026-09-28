import { ArrowLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { CodeBlock } from '@/components/code-block';
import { PageBody } from '@/components/page-body';
import { PageHeader } from '@/components/page-header';
import { SectionCard } from '@/components/section-card';
import { Link } from '@/i18n/navigation';
import { localizedTitle } from '@/i18n/metadata';
import { initProtectedRoute } from '@/lib/auth/route';
import { findConnection } from '@/lib/connections/repository';
import { getDb } from '@/lib/db/client';
import { GCP_OPTIONAL_ROLES } from '@/lib/gcp/check';
import { LOG_WINDOW_MS, recentLogEntries, type GcpSeverity } from '@/lib/gcp/logs';
import { gcpTargetFrom } from '@/lib/gcp/target';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { TONE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

type Props = { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ severity?: string }> };

export const generateMetadata = localizedTitle('GoogleLogs.title');

/** The floors worth offering. Below `WARNING` a busy project returns fifty lines of nothing useful. */
const OFFERED: readonly GcpSeverity[] = ['INFO', 'WARNING', 'ERROR', 'CRITICAL'];

/** Google's own severities, coloured by what they mean rather than by a scale OpsWatch invented. */
const SEVERITY_TEXT: Record<string, string> = {
  EMERGENCY: TONE_TEXT.danger,
  ALERT: TONE_TEXT.danger,
  CRITICAL: TONE_TEXT.danger,
  ERROR: TONE_TEXT.danger,
  WARNING: TONE_TEXT.warning,
};

/**
 * What a Google Cloud project is logging, right now.
 *
 * **The only part of a Google connection that reads content rather than figures**, and the reason it
 * sits behind a role of its own. Everything else OpsWatch reads from Google is a count, a status or a
 * number; a log line is whatever somebody's code wrote, and it may contain anything. So the role is
 * granted separately, the connection is complete without it, and this page says what granting it
 * allows before asking for it.
 *
 * Nothing here is stored and nothing is sent anywhere. It is fetched when the page is drawn, and in
 * particular it does not reach an AI provider — the one place in this product where "everything the
 * application wrote" could be handed to somebody else.
 */
export default async function GoogleLogsPage({ params, searchParams }: Props) {
  await initProtectedRoute(params);
  const { id } = await params;
  const db = getDb();
  const row = findConnection(db, id);
  if (row === null || row.provider !== 'gcp') notFound();

  const t = await getTranslations('GoogleLogs');
  const format = await getFormatter();

  const asked = (await searchParams).severity;
  const minSeverity: GcpSeverity = OFFERED.includes(asked as GcpSeverity) ? (asked as GcpSeverity) : 'WARNING';

  const target = gcpTargetFrom(row, null);
  const result = target.ok ? await recentLogEntries({ target: target.data, minSeverity, nowMs: pageNow() }) : null;
  const failure = target.ok ? (result !== null && !result.ok ? result.reason : null) : target.code === 'SecretChanged' ? 'secret_changed' : 'not_ready';
  const answered = result !== null && result.ok ? result : null;

  return (
    <PageBody>
      <Link href={`/accounts/${row.id}`} className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {t('back')}
      </Link>
      <PageHeader title={t('title', { project: row.gcpProjectId ?? '' })} description={t('description', { minutes: LOG_WINDOW_MS / 60_000 })} />

      {/* What this role allows, said before it is asked for, and which one it deliberately is not. */}
      <SectionCard title={t('grantTitle')} description={t('grantHint')} contentClassName="space-y-3">
        <p className="text-sm text-muted-foreground">{t('notPrivate')}</p>
        <CodeBlock
          value={GCP_OPTIONAL_ROLES.map(
            (role) =>
              `gcloud projects add-iam-policy-binding ${row.gcpProjectId ?? ''} \\\n  --member="principal://iam.googleapis.com/projects/${row.gcpProjectNumber ?? ''}/locations/global/workloadIdentityPools/${row.gcpPoolId ?? ''}/subject/${row.id}" \\\n  --role="${role}"`,
          ).join('\n')}
        />
        <p className="text-xs text-muted-foreground">{t('nothingStored')}</p>
      </SectionCard>

      <SectionCard title={t('listTitle')} description={t('listHint')}>
        {/* Google's own severities, as a floor. No free text reaches the query: its language can
            address any field of any log, and a box wired into it is a way to ask this project
            questions OpsWatch never meant to offer. */}
        <nav aria-label={t('severityLabel')} className="mb-4 flex flex-wrap gap-2">
          {OFFERED.map((severity) => (
            <Link
              key={severity}
              href={{ pathname: `/accounts/${row.id}/logs`, query: { severity } }}
              aria-current={severity === minSeverity ? 'page' : undefined}
              className={cn(
                'rounded-full border px-3 py-1 text-sm transition-colors',
                severity === minSeverity ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t('atLeast', { severity })}
            </Link>
          ))}
        </nav>

        {answered === null ? (
          <>
            <p className={cn('text-sm font-medium', TONE_TEXT.danger)}>{t(`failures.${failure ?? 'error'}`)}</p>
            <p className="mt-2 text-sm">
              <Link href={`/accounts/${row.id}`} className="text-primary underline-offset-4 hover:underline">
                {t('checkAccess')}
              </Link>
            </p>
          </>
        ) : answered.entries.length === 0 ? (
          // Quiet at this floor is a fact about this window and this severity, and says which.
          <p className="text-sm text-muted-foreground">{t('none', { severity: minSeverity, minutes: LOG_WINDOW_MS / 60_000 })}</p>
        ) : (
          <ul className="divide-y">
            {answered.entries.map((entry) => (
              <li key={entry.id} className="py-2">
                <div className="flex flex-wrap items-baseline gap-x-3 text-xs">
                  {/* Google's own word for how bad it is. Not remapped onto OpsWatch's three. */}
                  <span className={cn('font-medium', SEVERITY_TEXT[entry.severity] ?? 'text-muted-foreground')}>{entry.severity}</span>
                  <span className="text-muted-foreground">{entry.at === null ? t('noTime') : format.relativeTime(new Date(entry.at))}</span>
                  {/* `break-all` on both: these come from whatever wrote the log, and a long one
                      without it pushes the row past the edge of a narrow screen. */}
                  <span className="font-mono break-all text-muted-foreground">{entry.logName}</span>
                  {entry.resourceName !== null && <span className="break-all text-muted-foreground">{entry.resourceName}</span>}
                </div>
                {/* The line as Google returned it, wrapped rather than truncated on screen: a log
                    line cut off at the edge of a column is the half nobody needed. */}
                <p className="mt-1 font-mono text-xs break-all whitespace-pre-wrap">{entry.text === '' ? t('noText') : entry.text}</p>
              </li>
            ))}
          </ul>
        )}

        {answered !== null && (
          <div className="mt-3 space-y-1 border-t pt-3 text-xs text-muted-foreground">
            {answered.truncated && <p>{t('truncated')}</p>}
            <p>{t('readNow')}</p>
          </div>
        )}
      </SectionCard>
    </PageBody>
  );
}
