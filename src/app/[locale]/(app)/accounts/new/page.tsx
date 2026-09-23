import { ArrowLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { PageBody } from '@/components/page-body';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { localizedTitle } from '@/i18n/metadata';
import { Link } from '@/i18n/navigation';
import { initProtectedRoute } from '@/lib/auth/route';
import { getDb } from '@/lib/db/client';
import { INTEGRATION_SPECS } from '@/lib/integrations/catalogue';
import { integrationStatuses } from '@/lib/integrations/status';

type Props = { params: Promise<{ locale: string }> };

export const generateMetadata = localizedTitle('Connect.title');

/**
 * Choosing what to connect (§E).
 *
 * "Add account" used to mean "add an AWS account", which stopped being true the moment OpsWatch grew a
 * GitHub, a Cloudflare and an AI connection. It asks now.
 *
 * **One source of truth.** The cards read `integrationStatuses`, the same measured state the Integrations
 * page renders, and each one links to the flow that already configures it. Nothing here duplicates a
 * provider's onboarding: this page is a step in front of them, not a second copy of them.
 *
 * Google sign-in is not a card. It is an authentication provider configured in the environment, and
 * presenting it beside AWS as something to connect from a page would both misrepresent it and imply a
 * button that cannot exist — so it gets a sentence and a link instead.
 */
export default async function ChooseConnectionPage({ params }: Props) {
  await initProtectedRoute(params);
  const t = await getTranslations('Connect');
  const statuses = integrationStatuses(getDb()).filter((status) => INTEGRATION_SPECS[status.id].connectable);

  return (
    <PageBody>
      <PageHeader
        title={t('title')}
        description={t('description')}
        className="items-end gap-4"
        actions={
          <Button asChild variant="outline">
            <Link href="/accounts">
              <ArrowLeft className="size-4" aria-hidden /> {t('back')}
            </Link>
          </Button>
        }
      />

      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {statuses.map((status) => {
          const spec = INTEGRATION_SPECS[status.id];
          // A card that cannot be completed says so and offers no way in. There are no dead ends here.
          const reachable = spec.available && status.href !== null;
          return (
            <li key={status.id}>
              <Card className="flex h-full flex-col">
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base font-semibold">
                    {t(`names.${status.id}`)}
                    <Badge variant={status.state === 'connected' ? 'default' : 'secondary'}>{t(`states.${status.state}`)}</Badge>
                  </CardTitle>
                  <CardDescription>{t(`enables.${status.id}`)}</CardDescription>
                </CardHeader>
                <CardContent className="mt-auto flex flex-col gap-3">
                  {/* What OpsWatch will be allowed to do, beside the button that would grant it. */}
                  <p className="text-xs text-muted-foreground">{t(`access.${status.id}`)}</p>
                  {status.detailKey !== null && (
                    <p className="text-xs text-muted-foreground">{t(`detail.${status.detailKey}`, status.values)}</p>
                  )}
                  {reachable ? (
                    <Button asChild variant={status.state === 'connected' ? 'outline' : 'default'} className="w-full sm:w-auto">
                      <Link href={status.href ?? '/accounts'}>{t(status.state === 'not_configured' ? 'connect' : 'manage')}</Link>
                    </Button>
                  ) : (
                    <p className="text-sm">{t('unavailableHint')}</p>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">{t('signIn')}</CardTitle>
          <CardDescription>{t('signInHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/settings/integrations" className="text-sm font-medium underline-offset-4 hover:underline">
            {t('allIntegrations')}
          </Link>
        </CardContent>
      </Card>
    </PageBody>
  );
}
