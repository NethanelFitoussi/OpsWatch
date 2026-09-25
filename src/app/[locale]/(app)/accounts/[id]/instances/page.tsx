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
import { env } from '@/lib/env';
import { instancesInRegion } from '@/lib/gcp/instances';
import { openConnectionKey } from '@/lib/gcp/issuer';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { TONE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

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

  const result = await instancesInRegion({
    connectionId: row.id,
    projectId: row.gcpProjectId ?? '',
    region,
    target: {
      projectNumber: row.gcpProjectNumber ?? '',
      poolId: row.gcpPoolId ?? '',
      providerId: row.gcpProviderId ?? '',
      serviceAccount: row.gcpServiceAccount,
    },
    key: row.gcpKeyCiphertext === null ? null : openConnectionKey(row.gcpKeyCiphertext, env().OPSWATCH_SECRET),
    baseUrl: env().OPSWATCH_PUBLIC_URL,
    nowMs: pageNow(),
  });

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
        {!result.ok ? (
          // Why there is nothing, never an empty table: "could not read" and "none" are different answers.
          <>
            <p className={cn('text-sm font-medium', TONE_TEXT.danger)}>{t(`failures.${result.reason}`)}</p>
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
      </SectionCard>
    </PageBody>
  );
}
