import { ArrowLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { ConnectionStatusBadge } from '@/components/connection-status-badge';
import { PageBody } from '@/components/page-body';
import { PageHeader } from '@/components/page-header';
import { PermissionChecklist } from '@/components/permission-checklist';
import { SectionCard } from '@/components/section-card';
import { Link } from '@/i18n/navigation';
import { localizedTitle } from '@/i18n/metadata';
import { initProtectedRoute } from '@/lib/auth/route';
import { findConnection, toView } from '@/lib/connections/repository';
import { readCollection } from '@/lib/store/collection';
import { untestedRegions } from '@/lib/connections/tested-regions';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';
import { saveConnectionDetailsAction } from '../actions';
import { ConnectionDetailsForm } from './forms';
import { AmbientSection } from './sections/ambient-section';
import { DangerZone } from './sections/danger-zone';
import { IdentitySkeleton } from './sections/identity-skeleton';
import { KeysSection } from './sections/keys-section';
import { GoogleSetup } from './sections/google-setup';
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

  const untested = untestedRegions(view.regions, view.lastTest);
  // Where this account's data goes is not an advanced setting, so it is on the account page itself.
  const collection = readCollection(getDb(), row.id);

  const t = await getTranslations('AccountDetail');
  const tAccounts = await getTranslations('Accounts');
  const tChecklist = await getTranslations('Checklist');
  const tCollection = await getTranslations('Collection');

  return (
    <PageBody>
      <Link
        href="/accounts"
        className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft className="size-4" aria-hidden /> {t('back')}
      </Link>

      <PageHeader
        title={view.name}
        description={
          <>
            {tAccounts(`methods.${view.method}`)} ·{' '}
            {/* A project or an account, whichever this connection has — never a gap where the other
                cloud's identifier would be. */}
            {row.provider === 'gcp'
              ? t('projectLine', { project: row.gcpProjectId ?? '' })
              : t('accountLine', { account: view.awsAccountId ?? '', regions: view.regions.join(', ') })}
          </>
        }
        actions={<ConnectionStatusBadge status={view.status} />}
      />

      {/* Everything below is about one cloud or the other. A Google connection has no role to set up,
          no permission checklist of AWS services and no CloudFormation stack, and showing those empty
          would be describing a thing that is not there. */}
      {row.provider === 'gcp' ? (
        <GoogleSetup row={row} locale={locale} baseUrl={env().OPSWATCH_PUBLIC_URL} />
      ) : (
        <>
        <SectionCard title={t('details.title')} description={t('details.description')}>
          <ConnectionDetailsForm
            action={saveConnectionDetailsAction.bind(null, locale, view.id)}
            name={view.name}
            regions={view.regions}
          />
        </SectionCard>

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

        <SectionCard id="permissions" className="scroll-mt-20" title={tChecklist('title')} action={view.status !== 'draft' && <TestButton connectionId={view.id} />}>
          {/* A region added since the last test is a region the test never looked at. The badge cannot say
              that, so the card does — in words, before the checklist that would otherwise look complete. */}
          {untested.length > 0 && <p className="mb-3 text-sm text-amber-700 dark:text-amber-400">{t('details.untested', { regions: untested.join(', ') })}</p>}
          <PermissionChecklist result={view.lastTest} account={view.awsAccountId ?? ''} />
        </SectionCard>

        {/*
          * Where this account's data goes, on the account page rather than behind an advanced menu.
          *
          * It is a privacy decision before it is a technical one, and an operator should be able to answer
          * "is anything leaving my AWS account" without opening anything.
          */}
        <SectionCard title={tCollection('mode.title')} description={tCollection('mode.hint')}>
          <p className="text-sm">
            <strong className="font-medium">{collection.managed ? tCollection('mode.managed') : tCollection('mode.direct')}</strong>
            <span className="block text-muted-foreground">{collection.managed ? tCollection('mode.managedHint') : tCollection('mode.directHint')}</span>
          </p>
          <p className="mt-3">
            <Link href={`/accounts/${view.id}/collection`} className="text-sm text-primary underline-offset-4 hover:underline">
              {collection.managed ? tCollection('manage') : tCollection('setUp')}
            </Link>
          </p>
        </SectionCard>
        </>
      )}

      <DangerZone connectionId={view.id} locale={locale} region={view.regions[0] ?? ''} managed={collection.managed} provider={row.provider} />
    </PageBody>
  );
}
