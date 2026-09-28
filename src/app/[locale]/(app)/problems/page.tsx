import { ShieldCheck } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';
import { PageBody } from '@/components/page-body';
import { PageHeader } from '@/components/page-header';
import { SectionCard } from '@/components/section-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Link } from '@/i18n/navigation';
import { localizedTitle } from '@/i18n/metadata';
import { initProtectedRoute } from '@/lib/auth/route';
import { listConnections } from '@/lib/connections/repository';
import { PROVIDERS, type Provider } from '@/lib/connections/types';
import { getDb } from '@/lib/db/client';
import { scopeKindOf } from '@/lib/monitoring/shared/scopes';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { readProblemsAcross } from '@/lib/read/across';
import { insightRenderer } from '@/lib/read/render';
import { TONE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ provider?: string }> };

export const generateMetadata = localizedTitle('Problems.title');

const SEVERITY_TEXT: Record<string, string> = {
  critical: TONE_TEXT.danger,
  warning: TONE_TEXT.warning,
  info: 'text-muted-foreground',
};

/**
 * What is wrong anywhere (§G).
 *
 * **Instance-scoped, like Linux servers and Cloudflare**, because "what is wrong" is not an attribute
 * of one AWS account and region. The monitoring rail answers that question per environment, which is
 * right once you know where to look; an operator with three accounts and a Google project has to know
 * where to look before they can ask, and the answer then depends on where they started.
 *
 * **Provider identity is carried, never flattened.** Every row says which cloud produced it, which
 * connection, and what its scope is — a region, a project or an account, named as what it is. "The
 * payments database is at 98 % CPU" and "Google has an open incident on checkout" are not
 * interchangeable facts, and an operator fixes them in different places.
 *
 * The evidence is whatever the provider gave. Nothing here is a verdict OpsWatch reached about a cloud
 * it could not read: a connection nothing has been collected from contributes no rows and no zero.
 */
export default async function ProblemsAcrossPage({ params, searchParams }: Props) {
  const { locale } = await initProtectedRoute(params);
  const t = await getTranslations('Problems');
  const common = await getTranslations('Accounts');
  const format = await getFormatter();
  const db = getDb();

  const connections = listConnections(db);
  const connected = PROVIDERS.filter((provider) => connections.some((row) => row.provider === provider));
  const asked = (await searchParams).provider;
  const selected = connected.find((provider) => provider === asked) ?? null;

  const { problems, counts, truncated } = readProblemsAcross(
    db,
    selected === null ? {} : { providers: [selected] },
    { nowMs: pageNow(), render: await insightRenderer(locale) },
  );

  return (
    <PageBody>
      <PageHeader title={t('title')} description={t('description')} />

      {/* Counted across everything, so the number does not move when the list does. Only the clouds
          that are actually connected: a row of zeroes for a cloud nobody uses is noise. */}
      {connected.length > 1 && (
        <nav aria-label={t('filterLabel')} className="flex flex-wrap items-center gap-2">
          <Link
            href="/problems"
            aria-current={selected === null ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1 text-sm transition-colors',
              selected === null ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t('filterAll', { count: counts.total })}
          </Link>
          {connected.map((provider) => (
            <Link
              key={provider}
              href={{ pathname: '/problems', query: { provider } }}
              aria-current={selected === provider ? 'page' : undefined}
              className={cn(
                'rounded-full border px-3 py-1 text-sm transition-colors',
                selected === provider ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t('filterProvider', { provider: common(`provider.${provider}`), count: counts.byProvider[provider] })}
            </Link>
          ))}
        </nav>
      )}

      <SectionCard title={t('listTitle')} description={t('listHint')}>
        {problems.length === 0 ? (
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
            <div>
              {/*
                * "Nothing is open" is a statement about what was collected, and this page says so
                * rather than implying every cloud has been checked. A connection that has never been
                * collected from contributes nothing here, and nothing is not the same as nothing wrong.
                */}
              <p className="text-sm font-medium">{selected === null ? t('emptyTitle') : t('emptyFiltered')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('emptyHint')}</p>
            </div>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.problem')}</TableHead>
                <TableHead>{t('columns.where')}</TableHead>
                <TableHead>{t('columns.severity')}</TableHead>
                <TableHead>{t('columns.since')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {problems.map((problem) => (
                <TableRow key={problem.id}>
                  <TableCell className="font-medium">
                    {/* Into the rail where there is one. A Google problem has nowhere to go yet, and a
                        link into an AWS section would be a link to a service that cloud does not have. */}
                    {problem.href === null ? (
                      <span className="block">{problem.title}</span>
                    ) : (
                      <Link href={problem.href} className="block text-primary underline-offset-4 hover:underline">
                        {problem.title}
                      </Link>
                    )}
                    <span className="block text-xs text-muted-foreground">{problem.subject}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {/* The cloud, the connection and the scope — the three things that say where to go
                        and do something about it. */}
                    <span className="block">{common(`provider.${problem.provider}`)}</span>
                    <span className="block text-xs">
                      {problem.connectionName === '' ? t('connectionGone') : problem.connectionName} ·{' '}
                      {t(`scopeKind.${scopeKindOf(problem.provider as Provider)}`, { scope: problem.scope })}
                    </span>
                  </TableCell>
                  <TableCell className={cn('font-medium', SEVERITY_TEXT[problem.severity] ?? '')}>{t(`severity.${problem.severity}`)}</TableCell>
                  <TableCell className="text-muted-foreground">{format.relativeTime(new Date(problem.firstSeenAt))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {truncated && <p className="mt-3 text-xs text-muted-foreground">{t('truncated')}</p>}
        <p className="mt-3 text-xs text-muted-foreground">{t('collected')}</p>
      </SectionCard>
    </PageBody>
  );
}
