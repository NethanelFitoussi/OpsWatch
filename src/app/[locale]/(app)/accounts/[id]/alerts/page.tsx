import { ArrowLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { PageBody } from '@/components/page-body';
import { PageHeader } from '@/components/page-header';
import { SectionCard } from '@/components/section-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Link } from '@/i18n/navigation';
import { localizedTitle } from '@/i18n/metadata';
import { initProtectedRoute } from '@/lib/auth/route';
import { findConnection } from '@/lib/connections/repository';
import { getDb } from '@/lib/db/client';
import { projectAlerts, quietMeansSomething } from '@/lib/gcp/alerts';
import { gcpTargetFrom } from '@/lib/gcp/target';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { TONE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

type Props = { params: Promise<{ locale: string; id: string }> };

export const generateMetadata = localizedTitle('GoogleAlerts.title');

/**
 * What Google Cloud is complaining about in one project.
 *
 * **The evidence is entirely Google's.** Its policies, its severities, its open times. OpsWatch
 * decided none of it and adds no verdict of its own — the mission's rule that a health conclusion the
 * provider did not reach must not be manufactured.
 *
 * Which is why the policy count is on the page and not a footnote. An empty incident list means one
 * of two completely different things: nothing is wrong, or nothing is watching. A page that showed
 * both as "No open incidents" would be the most comfortable lie a monitoring tool can tell.
 */
export default async function GoogleAlertsPage({ params }: Props) {
  await initProtectedRoute(params);
  const { id } = await params;
  const db = getDb();
  const row = findConnection(db, id);
  if (row === null || row.provider !== 'gcp') notFound();

  const t = await getTranslations('GoogleAlerts');
  const format = await getFormatter();

  // Null, because this page is about the project: alerting policies and incidents belong to it, not
  // to a region within it. Said rather than passing a region nothing would read.
  const target = gcpTargetFrom(row, null);
  const result = target.ok ? await projectAlerts({ target: target.data, nowMs: pageNow() }) : null;
  const failure = target.ok ? (result !== null && !result.ok ? result.reason : null) : target.code === 'SecretChanged' ? 'secret_changed' : 'not_ready';
  const answered = result !== null && result.ok ? result : null;

  return (
    <PageBody>
      <Link href={`/accounts/${row.id}`} className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {t('back')}
      </Link>
      <PageHeader title={t('title', { project: row.gcpProjectId ?? '' })} description={t('description')} />

      <SectionCard title={t('listTitle')} description={t('listHint')}>
        {answered === null ? (
          // Why there is nothing, never an empty list: "could not read" and "none" are different answers.
          <>
            <p className={cn('text-sm font-medium', TONE_TEXT.danger)}>{t(`failures.${failure ?? 'error'}`)}</p>
            <p className="mt-2 text-sm">
              <Link href={`/accounts/${row.id}`} className="text-primary underline-offset-4 hover:underline">
                {t('checkAccess')}
              </Link>
            </p>
          </>
        ) : answered.incidents.length === 0 ? (
          /*
           * The two answers that must not look alike. With something switched on to notice, quiet is
           * a fact Google is asserting. With nothing switched on, quiet is the absence of anybody
           * having asked — and saying "nothing is wrong" there would be OpsWatch inventing a verdict.
           */
          quietMeansSomething(answered.policies) ? (
            <p className={cn('text-sm font-medium', TONE_TEXT.success)}>{t('quiet', { enabled: answered.policies.enabled })}</p>
          ) : (
            <>
              <p className="text-sm font-medium">{t('unwatchedTitle')}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {answered.policies.total === 0 ? t('unwatchedNone') : t('unwatchedDisabled', { total: answered.policies.total })}
              </p>
            </>
          )
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.policy')}</TableHead>
                <TableHead>{t('columns.severity')}</TableHead>
                <TableHead>{t('columns.resource')}</TableHead>
                <TableHead>{t('columns.opened')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {answered.incidents.map((incident) => (
                <TableRow key={incident.id}>
                  {/* Google's own policy name, not a rewrite of it: this is the wording in their
                      console and in the email an operator may already have received. */}
                  <TableCell className="font-medium">{incident.policy === '' ? t('unnamedPolicy') : incident.policy}</TableCell>
                  {/* Google's severity where it set one. A policy with none is not "low". */}
                  <TableCell className="text-muted-foreground">{incident.severity ?? t('noSeverity')}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {incident.resourceName ?? incident.resourceType ?? t('notReported')}
                    {incident.resourceName !== null && incident.resourceType !== null && (
                      <span className="block text-xs">{incident.resourceType}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {incident.openedAt === null ? t('notReported') : format.relativeTime(new Date(incident.openedAt))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {answered !== null && (
          <div className="mt-3 space-y-1 border-t pt-3 text-xs text-muted-foreground">
            {/* Always, including when incidents are listed: how much of the project is actually
                watched is context for every one of them. */}
            <p>{t('policies', { enabled: answered.policies.enabled, total: answered.policies.total })}</p>
            {answered.truncated && <p>{t('incidentsTruncated')}</p>}
            {answered.policies.truncated && <p>{t('policiesTruncated')}</p>}
            <p>{t('readNow')}</p>
          </div>
        )}
      </SectionCard>
    </PageBody>
  );
}
