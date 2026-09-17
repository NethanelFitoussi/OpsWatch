import { Plus } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';
import { ConnectionStatusBadge } from '@/components/connection-status-badge';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { localizedTitle } from '@/i18n/metadata';
import { Link } from '@/i18n/navigation';
import { initProtectedRoute } from '@/lib/auth/route';
import { listConnections, toView } from '@/lib/connections/repository';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';

type Props = { params: Promise<{ locale: string }> };

export const generateMetadata = localizedTitle('Accounts.title');

export default async function AccountsPage({ params }: Props) {
  await initProtectedRoute(params);
  const t = await getTranslations('Accounts');
  const format = await getFormatter();
  const views = listConnections(getDb()).map((row) => toView(row, env().OPSWATCH_SECRET));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('description')}
        className="items-end gap-4"
        actions={
          <Button asChild>
            <Link href="/accounts/new">
              <Plus className="size-4" aria-hidden /> {t('add')}
            </Link>
          </Button>
        }
      />

      {views.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader className="items-center text-center">
            <CardTitle>{t('emptyTitle')}</CardTitle>
            <CardDescription>{t('emptyDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center gap-3">
            <Button asChild>
              <Link href="/accounts/new">{t('add')}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/getting-started">{t('emptyGuide')}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {views.map((c) => (
            <li key={c.id}>
              <Link href={`/accounts/${c.id}`} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
                <Card className="h-full transition-colors hover:border-primary/40">
                  <CardHeader className="flex-row items-start justify-between gap-3">
                    <div>
                      <CardTitle>{c.name}</CardTitle>
                      <CardDescription>
                        {t('accountId')} {c.awsAccountId} · {t(`methods.${c.method}`)}
                      </CardDescription>
                      {(c.method === 'keys' || c.templateOutdated) && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {c.method === 'keys' && (
                            <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
                              {t('localTesting')}
                            </Badge>
                          )}
                          {c.templateOutdated && <Badge variant="outline">{t('updateStack')}</Badge>}
                        </div>
                      )}
                    </div>
                    <ConnectionStatusBadge status={c.status} />
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    <p>{t('regions')}: {c.regions.join(', ')}</p>
                    <p>
                      {c.lastTest
                        ? t('lastTested', { date: format.relativeTime(new Date(c.lastTest.testedAt)) })
                        : t('neverTested')}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
