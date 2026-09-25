import { Cloud, Plus } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';
import { ConnectionCard } from '@/components/connections/connection-card';
import { PageBody } from '@/components/page-body';
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
import { INTEGRATION_SPECS } from '@/lib/integrations/catalogue';
import { integrationStatuses } from '@/lib/integrations/status';
import { CONNECTION_TONES, INTEGRATION_TONES } from '@/lib/integrations/tone';
import { listManagedConnections } from '@/lib/store/collection';

type Props = { params: Promise<{ locale: string }> };

export const generateMetadata = localizedTitle('Accounts.title');

/**
 * Everything this installation is connected to, in one list (UX-20).
 *
 * An AWS account used to be a card and everything else a line of text at the bottom, which said that AWS
 * was the product and the rest was an afterthought. They are the same card now: one provider glyph, one
 * measured state, one way in. What still differs between them is how much is known — an AWS account has
 * regions and a last permission test, GitHub has a repository count — and that is all that differs.
 *
 * **One source of truth.** The non-AWS cards read `integrationStatuses`, exactly what `/accounts/new` and
 * `/settings/integrations` read, so the three screens cannot disagree about what is connected.
 */
export default async function AccountsPage({ params }: Props) {
  await initProtectedRoute(params);
  const t = await getTranslations('Accounts');
  // The two vocabularies these cards borrow rather than restate: the result of an AWS permission test,
  // and the measured detail of an integration. One copy of each, shared with the pages that own them.
  const status = await getTranslations('Status');
  const integrations = await getTranslations('Settings.integrations');
  const format = await getFormatter();
  const db = getDb();
  const views = listConnections(db).map((row) => toView(row, env().OPSWATCH_SECRET));
  // Whether each connection is forwarding anything. Connecting an AWS account says nothing about
  // whether logs may leave it, and the card is where that distinction has to be visible.
  const collection = new Map(listManagedConnections(db).map((row) => [row.connectionId, row.managed && row.realtimeLogs]));
  const others = integrationStatuses(db).filter((entry) => entry.id !== 'aws' && INTEGRATION_SPECS[entry.id].connectable);
  const nothing = views.length === 0 && others.every((entry) => entry.state === 'not_configured');

  return (
    <PageBody>
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

      {nothing && (
        <Card className="border border-dashed py-10 ring-0">
          <CardHeader className="justify-items-center text-center">
            <span className="mb-2 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Cloud className="size-6" aria-hidden />
            </span>
            <CardTitle className="text-lg font-semibold">{t('emptyTitle')}</CardTitle>
            <CardDescription className="max-w-md">{t('emptyDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap justify-center gap-3 pt-2">
            <Button asChild>
              <Link href="/accounts/new">{t('add')}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/getting-started">{t('emptyGuide')}</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {views.map((c) => (
          <li key={c.id}>
            <ConnectionCard
              integration="aws"
              scope="connection"
              state={c.status}
              provider={t('provider.aws')}
              tone={CONNECTION_TONES[c.status]}
              stateLabel={status(c.status)}
              title={c.name}
              href={`/accounts/${c.id}`}
              actionLabel={t('manageOther')}
              badges={
                (c.method === 'keys' || c.templateOutdated || collection.get(c.id) === true) && (
                  <div className="flex flex-wrap gap-2">
                    {c.method === 'keys' && (
                      <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
                        {t('localTesting')}
                      </Badge>
                    )}
                    {c.templateOutdated && <Badge variant="outline">{t('updateStack')}</Badge>}
                    {/*
                      * Connected and forwarding are different things, and this is where an operator with
                      * several accounts can see which is which. Only shown when it is on: the absence of
                      * a badge is the default state, and a badge saying "off" on every card is noise.
                      */}
                    {collection.get(c.id) === true && <Badge variant="outline">{t('collectionOn')}</Badge>}
                  </div>
                )
              }
              facts={[
                { label: t('accountId'), value: `${c.awsAccountId} · ${t(`methods.${c.method}`)}` },
                { label: t('regions'), value: c.regions.join(', ') },
                {
                  label: t('tested'),
                  value: c.lastTest ? format.relativeTime(new Date(c.lastTest.testedAt)) : t('neverTested'),
                },
              ]}
            />
          </li>
        ))}

        {others.map((entry) => (
          <li key={entry.id}>
            <ConnectionCard
              integration={entry.id}
              state={entry.state}
              provider={t(`provider.${entry.id}`)}
              tone={INTEGRATION_TONES[entry.state]}
              stateLabel={t(`states.${entry.state}`)}
              title={t(`provider.${entry.id}`)}
              href={entry.href}
              actionLabel={t(entry.state === 'not_configured' ? 'connectOther' : 'manageOther')}
              notes={entry.detailKey !== null && <p>{integrations(`detail.${entry.detailKey}`, entry.values)}</p>}
            />
          </li>
        ))}
      </ul>

      <p>
        <Link href="/settings/integrations" className="text-sm font-medium underline-offset-4 hover:underline">
          {t('allIntegrations')}
        </Link>
      </p>
    </PageBody>
  );
}
