import { ArrowLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { ConnectionStatusBadge } from '@/components/connection-status-badge';
import { PageHeader } from '@/components/page-header';
import { PermissionChecklist } from '@/components/permission-checklist';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { localizedTitle } from '@/i18n/metadata';
import { initProtectedRoute } from '@/lib/auth/route';
import { findConnection, toView } from '@/lib/connections/repository';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';
import { AmbientSection } from './sections/ambient-section';
import { DangerZone } from './sections/danger-zone';
import { IdentitySkeleton } from './sections/identity-skeleton';
import { KeysSection } from './sections/keys-section';
import { RoleArnCard, RoleIdentityAndTemplate } from './sections/role-setup';
import { TestButton } from './test-button';

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ error?: string }>;
};

// A generic title: metadata is generated independently of the session check, so it must not read the connection.
export const generateMetadata = localizedTitle('AccountDetail.metaTitle');

export default async function ConnectionPage({ params, searchParams }: Props) {
  // Auth and the lookup stay outside any Suspense boundary, so an unknown connection still answers 404.
  const { locale } = await initProtectedRoute(params);
  const { id } = await params;
  const { error } = await searchParams;
  const row = findConnection(getDb(), id);
  if (!row) {
    notFound();
  }
  const view = toView(row, env().OPSWATCH_SECRET);

  const t = await getTranslations('AccountDetail');
  const tAccounts = await getTranslations('Accounts');
  const tChecklist = await getTranslations('Checklist');

  return (
    <div className="space-y-6">
      <Link href="/accounts" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {t('back')}
      </Link>

      <PageHeader
        title={view.name}
        description={
          <>
            {tAccounts(`methods.${view.method}`)} · {t('accountLine', { account: view.awsAccountId, regions: view.regions.join(', ') })}
          </>
        }
        actions={<ConnectionStatusBadge status={view.status} />}
      />

      {view.method === 'role' && (
        <>
          <Suspense fallback={<IdentitySkeleton cards={2} />}>
            <RoleIdentityAndTemplate view={view} locale={locale} error={error} />
          </Suspense>
          <RoleArnCard view={view} locale={locale} />
        </>
      )}

      {view.method === 'keys' && <KeysSection view={view} locale={locale} />}

      {view.method === 'ambient' && (
        <Suspense fallback={<IdentitySkeleton />}>
          <AmbientSection region={view.regions[0]} />
        </Suspense>
      )}

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle><h2>{tChecklist('title')}</h2></CardTitle>
          {view.status !== 'draft' && <TestButton connectionId={view.id} />}
        </CardHeader>
        <CardContent>
          <PermissionChecklist result={view.lastTest} account={view.awsAccountId} />
        </CardContent>
      </Card>

      <DangerZone connectionId={view.id} locale={locale} />
    </div>
  );
}
