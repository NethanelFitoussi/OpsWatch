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
import { findConnection, readDoToken } from '@/lib/connections/repository';
import { getDb } from '@/lib/db/client';
import { listDroplets } from '@/lib/do/droplets';
import { env } from '@/lib/env';
import { TONE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

type Props = { params: Promise<{ locale: string; id: string }> };

export const generateMetadata = localizedTitle('DoDroplets.title');

/**
 * The droplets of a DigitalOcean account.
 *
 * On the connection, for the same reason Google's instances are: the monitoring rail's ten sections
 * are ten AWS services, and carrying another provider through it would offer pages that can never hold
 * anything. Read live, with no collector behind it, and the page says so rather than letting a figure
 * look older or newer than it is.
 */
export default async function DropletsPage({ params }: Props) {
  await initProtectedRoute(params);
  const { id } = await params;
  const db = getDb();
  const row = findConnection(db, id);
  if (row === null || row.provider !== 'do') notFound();

  const t = await getTranslations('DoDroplets');
  const format = await getFormatter();
  const result = await listDroplets({ token: readDoToken(row, env().OPSWATCH_SECRET) });

  return (
    <PageBody>
      <Link href={`/accounts/${row.id}`} className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {t('back')}
      </Link>
      <PageHeader title={t('title', { name: row.name })} description={t('description')} />

      <SectionCard title={t('listTitle')} description={t('listHint')}>
        {!result.ok ? (
          // Why there is nothing, never an empty table.
          <p className={cn('text-sm font-medium', TONE_TEXT.danger)}>{t(`failures.${result.reason}`)}</p>
        ) : result.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('none')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.name')}</TableHead>
                <TableHead>{t('columns.status')}</TableHead>
                <TableHead>{t('columns.region')}</TableHead>
                <TableHead>{t('columns.size')}</TableHead>
                <TableHead>{t('columns.created')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.map((droplet) => (
                <TableRow key={droplet.id}>
                  <TableCell className="font-medium">
                    <span className="block">{droplet.name}</span>
                    <span className="block font-mono text-xs text-muted-foreground">{droplet.id}</span>
                  </TableCell>
                  {/* DigitalOcean's own word, which is what their console shows too. */}
                  <TableCell className={cn(droplet.status === 'active' ? TONE_TEXT.success : 'text-muted-foreground')}>{droplet.status}</TableCell>
                  <TableCell className="text-muted-foreground">{droplet.region ?? t('notReported')}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {droplet.size ?? t('notReported')}
                    {droplet.memoryMb !== null && droplet.vcpus !== null && (
                      <span className="block text-xs">{t('sizeDetail', { memory: droplet.memoryMb, vcpus: droplet.vcpus })}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {droplet.createdAt === null ? t('notReported') : format.relativeTime(new Date(droplet.createdAt))}
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
