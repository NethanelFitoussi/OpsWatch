import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { PageBody } from '@/components/page-body';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SectionHeading } from '@/components/getting-started/section-heading';
import { localizedTitle } from '@/i18n/metadata';
import { Link } from '@/i18n/navigation';
import { getCurrentAdminId } from '@/lib/auth/current';
import { getDb } from '@/lib/db/client';
import { GUIDED, guidePath, setupPath } from '@/lib/integrations/guides';
import { integrationStatuses } from '@/lib/integrations/status';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }> };

export const generateMetadata = localizedTitle('GettingStarted.metaTitle');

/**
 * Get started (§D).
 *
 * It used to be the AWS guide, which was true while OpsWatch was an AWS tool and stopped being true the
 * moment it grew a GitHub, a Cloudflare and an AI connection. The first screen asks what you want to
 * connect; AWS is the first card because it is what most installations start with, and it is one of four.
 *
 * **The same measured state as everywhere else.** The cards read `integrationStatuses`, which is what
 * `/accounts/new` and `/settings/integrations` read. Three entry points, one source of truth, so they
 * cannot contradict each other — a card saying "connect AWS" while the accounts page lists two accounts
 * would make every other claim on the page suspect.
 *
 * Google sign-in is not here. It is authentication, not something OpsWatch reads from, and it is
 * configured in the environment — a guide walking somebody towards a page that cannot configure it would
 * be a dead end dressed as a step.
 */
export default async function GettingStartedPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('GettingStarted');
  const signedIn = (await getCurrentAdminId()) !== null;
  const byId = new Map(integrationStatuses(getDb()).map((status) => [status.id, status]));

  return (
    <AppShell signedIn={signedIn}>
      <PageBody className="mx-auto max-w-5xl space-y-14">
        <header className="rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-background px-6 py-10 md:px-10">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{t('hub.title')}</h1>
          <p className="mt-3 max-w-2xl text-lg text-muted-foreground">{t('hub.subtitle')}</p>
          <p className="mt-2 max-w-2xl text-muted-foreground">{t('hub.intro')}</p>
        </header>

        <section aria-labelledby="guides-title" className="space-y-6">
          <SectionHeading as="h2" id="guides-title" title={t('hub.guidesTitle')} intro={t('hub.guidesIntro')} />
          <ul className="grid gap-4 md:grid-cols-2">
            {GUIDED.map((id) => {
              const status = byId.get(id);
              const state = status?.state ?? 'not_configured';
              const connected = state === 'connected';
              return (
                <li key={id} data-integration={id} data-state={state}>
                  <Card className="flex h-full flex-col">
                    <CardHeader>
                      <CardTitle className="flex flex-wrap items-center gap-2 text-base font-semibold">
                        {t(`hub.names.${id}`)}
                        <Badge variant={connected ? 'default' : 'secondary'}>{t(`hub.states.${state}`)}</Badge>
                      </CardTitle>
                      <CardDescription>{t(`hub.unlocks.${id}`)}</CardDescription>
                    </CardHeader>
                    <CardContent className="mt-auto space-y-3">
                      {/* The measured detail, in every state rather than only when something is wrong: a
                          badge alone tells nobody what is connected, and "Connected · 1 zone" is the
                          sentence that makes the badge checkable. */}
                      {status?.detailKey != null && (
                        <p className="text-sm text-muted-foreground">{t(`hub.detail.${status.detailKey}`, status.values)}</p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button asChild variant={connected ? 'outline' : 'default'}>
                          <Link href={guidePath(id)}>{t('hub.readGuide')}</Link>
                        </Button>
                        {/* Anything already configured is managed, not set up again — including one that
                            needs attention, where "set it up" would send somebody back to the beginning. */}
                        <Button asChild variant="outline">
                          <Link href={setupPath(id)}>{t(state === 'not_configured' ? 'hub.setUp' : 'hub.manage')}</Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="signin-title" className="space-y-4">
          <SectionHeading as="h2" id="signin-title" title={t('hub.signInTitle')} intro={t('hub.signInIntro')} />
          <Link href="/settings/integrations" className="text-sm font-medium underline-offset-4 hover:underline">
            {t('hub.allIntegrations')}
          </Link>
        </section>
      </PageBody>
    </AppShell>
  );
}
