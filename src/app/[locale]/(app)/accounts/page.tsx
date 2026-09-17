import { Plus } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { ConnectionStatusBadge } from '@/components/connection-status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { requireAdmin } from '@/lib/auth/current';
import { listConnections, toView } from '@/lib/connections/repository';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';

type Props = { params: Promise<{ locale: string }> };

export default async function AccountsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  // The (app) layout also checks, but a layout does not stop this segment from rendering in an RSC request.
  await requireAdmin(locale);
  const t = await getTranslations('Accounts');
  const format = await getFormatter();
  const views = listConnections(getDb()).map((row) => toView(row, env().OPSWATCH_SECRET));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <Button asChild>
          <Link href="/accounts/new">
            <Plus className="size-4" aria-hidden /> {t('add')}
          </Link>
        </Button>
      </div>

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
