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
import { instancesInRegion } from '@/lib/gcp/instances';
import { CPU_METRIC, instanceCpuSeries, latestOf } from '@/lib/gcp/metrics';
import { gcpTargetFrom } from '@/lib/gcp/target';
import { SPARKLINE_HEIGHT, SPARKLINE_WIDTH, sparklinePoints } from '@/lib/monitoring/shared/sparkline';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { TONE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

/** Fifteen minutes at Google's own one-minute sampling: fifteen points, enough to show a shape. */
const CPU_WINDOW_MS = 15 * 60_000;

type Props = { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ region?: string }> };

export const generateMetadata = localizedTitle('GoogleInstances.title');

/**
 * The instances of a Google Cloud project, one region at a time.
 *
 * **On the connection rather than in the monitoring rail.** Every section of that rail is a page about
 * an AWS service, and a Google connection carried through it would offer Containers, Databases and Load
 * balancers that can never have anything in them. Putting one Google page into a nav built for ten AWS
 * ones would be the half-built version of a unified model; this is the whole of what OpsWatch can read
 * from a project today, where it belongs, and the roadmap says what is missing rather than the product
 * implying otherwise.
 *
 * Read when the page is drawn, with a token minted for the occasion. Nothing is stored: there is no
 * collector for Google Cloud yet, and a cache would be a claim about freshness nobody is keeping.
 */
export default async function GoogleInstancesPage({ params, searchParams }: Props) {
  await initProtectedRoute(params);
  const { id } = await params;
  const db = getDb();
  const row = findConnection(db, id);
  if (row === null || row.provider !== 'gcp') notFound();

  const t = await getTranslations('GoogleInstances');
  const format = await getFormatter();
  const asked = (await searchParams).region;
  const region = row.regions.includes(asked ?? '') ? (asked as string) : (row.regions[0] ?? '');

  // The federation details are five nullable columns, and this page used to turn each missing one into
  // an empty string — which builds an audience of `projects//locations/...`, sends it, and reports a
  // connection nobody finished setting up as a token Google rejected. The target is resolved or it is
  // not, and "not finished" says so in those words.
  const target = gcpTargetFrom(row, region);
  const result = target.ok
    ? await instancesInRegion({
        connectionId: target.data.connectionId,
        projectId: target.data.projectId,
        region: target.data.region,
        target: target.data.federation,
        key: target.data.key,
        baseUrl: target.data.baseUrl,
        nowMs: pageNow(),
      })
    : null;
  // One reason to show, whether it came from resolving the connection or from Google.
  const failure = target.ok ? (result !== null && !result.ok ? result.reason : null) : target.code === 'SecretChanged' ? 'secret_changed' : 'not_ready';

  /*
   * CPU for the instances that were found, in one request for all of them.
   *
   * Second, and only on success: asking Cloud Monitoring which instances exist would be asking the
   * wrong service. And its failure is kept apart from the list's — an instance list that was read is
   * worth showing even when the metric read was refused, because `roles/monitoring.viewer` and
   * `roles/compute.viewer` are two grants and an operator very often has one and not the other.
   */
  const nowMs = pageNow();
  const instances = result !== null && result.ok ? result.data : [];
  const cpu =
    target.ok && instances.length > 0
      ? await instanceCpuSeries({
          target: target.data,
          instanceIds: instances.map((instance) => instance.id),
          startMs: nowMs - CPU_WINDOW_MS,
          endMs: nowMs,
          nowMs,
        })
      : null;
  const series = new Map((cpu !== null && cpu.ok ? cpu.data : []).map((entry) => [entry.instanceId, entry]));

  return (
    <PageBody>
      <Link href={`/accounts/${row.id}`} className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {t('back')}
      </Link>
      <PageHeader title={t('title', { project: row.gcpProjectId ?? '' })} description={t('description')} />

      {/* Only when there is a choice: one region is not a picker, it is the heading already. */}
      {row.regions.length > 1 && (
        <SectionCard title={t('regionTitle')}>
          <div className="flex flex-wrap gap-2">
            {row.regions.map((one) => (
              <Link
                key={one}
                href={{ pathname: `/accounts/${row.id}/instances`, query: { region: one } }}
                aria-current={one === region ? 'page' : undefined}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm',
                  one === region ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                {one}
              </Link>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard title={t('listTitle', { region })} description={t('listHint')}>
        {failure !== null || result === null || !result.ok ? (
          // Why there is nothing, never an empty table: "could not read" and "none" are different answers.
          <>
            <p className={cn('text-sm font-medium', TONE_TEXT.danger)}>{t(`failures.${failure ?? 'error'}`)}</p>
            <p className="mt-2 text-sm">
              <Link href={`/accounts/${row.id}`} className="text-primary underline-offset-4 hover:underline">
                {t('checkAccess')}
              </Link>
            </p>
          </>
        ) : result.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('none', { region })}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.name')}</TableHead>
                <TableHead>{t('columns.status')}</TableHead>
                <TableHead>{t('columns.cpu')}</TableHead>
                <TableHead>{t('columns.zone')}</TableHead>
                <TableHead>{t('columns.machineType')}</TableHead>
                <TableHead>{t('columns.created')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.map((instance) => (
                <TableRow key={instance.id}>
                  <TableCell className="font-medium">
                    <span className="block">{instance.name}</span>
                    <span className="block font-mono text-xs text-muted-foreground">{instance.id}</span>
                  </TableCell>
                  {/* Google's own word. "TERMINATED" is what their console says, and a translation of it
                      would be a second vocabulary for an operator to learn. */}
                  <TableCell className={cn(instance.status === 'RUNNING' ? TONE_TEXT.success : 'text-muted-foreground')}>
                    {instance.status}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const latest = latestOf(series.get(instance.id));
                      /*
                       * Null is "Google reported nothing for this instance", which is the honest answer
                       * for a stopped one — and must not be drawn as 0 %, a flat green line under a
                       * machine that is switched off. §2.4: healthy and "cannot tell" never look alike.
                       */
                      if (latest === null) {
                        return <span className="text-muted-foreground">{cpu !== null && !cpu.ok ? t(`cpuFailures.${cpu.reason}`) : t('notReported')}</span>;
                      }
                      const points = series.get(instance.id)?.points ?? [];
                      return (
                        <span className="flex items-center gap-2">
                          {/* A fraction of one, turned into a percentage once and at the last moment. */}
                          <span className="tabular-nums">{format.number(latest, { style: 'percent', maximumFractionDigits: 1 })}</span>
                          {points.length > 1 && (
                            <svg
                              width={SPARKLINE_WIDTH}
                              height={SPARKLINE_HEIGHT}
                              viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
                              className="text-muted-foreground"
                              role="img"
                              aria-label={t('cpuTrend', { minutes: CPU_WINDOW_MS / 60_000 })}
                            >
                              {/* Scaled to a full one, not to the window's own maximum: a machine idling
                                  between 1 % and 2 % must not draw the same alarming climb as one going
                                  from 40 % to 90 %. */}
                              <polyline points={sparklinePoints(points.map((point) => point.value), SPARKLINE_WIDTH, SPARKLINE_HEIGHT, 1)} fill="none" stroke="currentColor" strokeWidth="1.5" />
                            </svg>
                          )}
                        </span>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{instance.zone}</TableCell>
                  {/* Null is "Google did not report it", which is not the same as an empty cell. */}
                  <TableCell className="text-muted-foreground">{instance.machineType ?? t('notReported')}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {instance.createdAt === null ? t('notReported') : format.relativeTime(new Date(instance.createdAt))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="mt-3 text-xs text-muted-foreground">{t('readNow')}</p>
        {/* What is here without installing anything, and what is not here because it cannot be. Said on
            the page rather than left as an absent column an operator has to work out for themselves, and
            set apart from the note above it so the second sentence is not read as more of the first. */}
        <div className="mt-3 space-y-1 border-t pt-3 text-xs text-muted-foreground">
          <p>{t('agentless', { metric: CPU_METRIC })}</p>
          <p>{t('needsAgent')}</p>
        </div>
        {cpu !== null && cpu.ok && cpu.truncated && <p className="mt-1 text-xs text-muted-foreground">{t('cpuTruncated')}</p>}
      </SectionCard>
    </PageBody>
  );
}
