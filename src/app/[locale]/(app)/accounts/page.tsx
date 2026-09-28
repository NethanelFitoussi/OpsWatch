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
import { PROVIDERS, type Provider } from '@/lib/connections/types';
import { cn } from '@/lib/utils';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ provider?: string }> };

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
export default async function AccountsPage({ params, searchParams }: Props) {
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

  /*
   * How many connections to each cloud, and which one is being looked at.
   *
   * Counted from every connection, never from the filtered list: a count that changed when you
   * filtered would be answering a different question from the one it appears to answer. Only
   * providers that are actually connected get a chip — an installation with no Google project does
   * not need to be told it has none, and a row of zeroes reads as a product nagging about what you
   * have not bought.
   */
  const counts = new Map<Provider, number>();
  for (const view of views) counts.set(view.provider, (counts.get(view.provider) ?? 0) + 1);
  const present = PROVIDERS.filter((provider) => (counts.get(provider) ?? 0) > 0);

  const asked = (await searchParams).provider;
  const selected = present.find((provider) => provider === asked) ?? null;
  const shown = selected === null ? views : views.filter((view) => view.provider === selected);

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

      {/*
        * How many connections to each cloud, and a way to look at one of them.
        *
        * Links rather than a client-side control: the filtered view has a URL somebody can send to a
        * colleague or keep in a tab, it survives a reload, and it works before any JavaScript does.
        *
        * Shown only when there is more than one cloud connected. A filter with a single option is a
        * control that cannot do anything, and the count it carries is already the length of the list
        * underneath it.
        */}
      {present.length > 1 && (
        <nav aria-label={t('filterLabel')} className="flex flex-wrap items-center gap-2">
          <Link
            href="/accounts"
            aria-current={selected === null ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1 text-sm transition-colors',
              selected === null ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t('filterAll', { count: views.length })}
          </Link>
          {present.map((provider) => (
            <Link
              key={provider}
              href={{ pathname: '/accounts', query: { provider } }}
              aria-current={selected === provider ? 'page' : undefined}
              className={cn(
                'rounded-full border px-3 py-1 text-sm transition-colors',
                selected === provider ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {/* The provider's own name and its own count. Never "Cloud 3": which cloud is the
                  question this page exists to answer. */}
              {t('filterProvider', { provider: t(`provider.${provider}`), count: counts.get(provider) ?? 0 })}
            </Link>
          ))}
        </nav>
      )}

      {/* `minmax(0,1fr)`, not `1fr`: a grid track sized `1fr` still refuses to go below its content's
          min-content width, and a card holding a `truncate` line — which is `white-space: nowrap` —
          contributes that whole line. At 360px the card then grew past the screen, and the longer
          the language the further: 41px in English, 119px in French. */}
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[repeat(2,minmax(0,1fr))] xl:grid-cols-[repeat(3,minmax(0,1fr))] 2xl:grid-cols-[repeat(4,minmax(0,1fr))]">
        {shown.map((c) => (
          <li key={c.id} className="min-w-0">
            <ConnectionCard
              // The connection's own cloud, not AWS for everything. Every card used to carry the AWS
              // glyph and the word "AWS", so a Google project and a DigitalOcean account were both
              // presented as AWS accounts on the one page whose job is to say what you are connected to.
              integration={c.provider}
              scope="connection"
              state={c.status}
              provider={t(`provider.${c.provider}`)}
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
                {
                  // The account or the project, whichever this connection is to: a Google row showing an
                  // empty account id would read as an AWS account whose number nobody filled in. A
                  // DigitalOcean account has neither, and is identified by its token, so it says so.
                  label: c.provider === 'gcp' ? t('projectId') : c.provider === 'do' ? t('account') : t('accountId'),
                  value:
                    c.provider === 'do'
                      ? t(`methods.${c.method}`)
                      : `${c.awsAccountId ?? c.gcpProjectId ?? ''} · ${t(`methods.${c.method}`)}`,
                },
                // A DigitalOcean account has no regions to choose: its API is account-wide and each
                // droplet carries its own. An empty "Regions:" would read as a misconfiguration.
                ...(c.regions.length > 0 ? [{ label: t('regions'), value: c.regions.join(', ') }] : []),
                {
                  label: t('tested'),
                  value: c.lastTest ? format.relativeTime(new Date(c.lastTest.testedAt)) : t('neverTested'),
                },
              ]}
            />
          </li>
        ))}

        {/* Only when nothing is filtered: GitHub is not an AWS account, and a cloud filter that left it
            on screen would be answering "show me AWS" with a list containing something else. */}
        {selected === null &&
          others.map((entry) => (
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
