import { getTranslations } from 'next-intl/server';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { localizedTitle } from '@/i18n/metadata';
import { requireAdmin } from '@/lib/auth/current';
import { getDb } from '@/lib/db/client';
import { listIntegrations, listRepositories } from '@/lib/store/repositories';
import { deleteRepositoryAction, saveRepositoryAction, saveTokenAction } from './actions';
import { RepositoriesForm } from './repositories-form';

type Props = { params: Promise<{ locale: string }> };

export const dynamic = 'force-dynamic';
export const generateMetadata = localizedTitle('Settings.repositories.title');

/**
 * Settings → Repositories (§13, §I).
 *
 * Where an operator tells OpsWatch which repositories exist. The mapping from a service to one of them is
 * made per environment, on the Problem detail where the question actually arises — §I asks for a mapping a
 * user can inspect and correct, and the moment they most want to correct it is when they are looking at the
 * wrong code.
 */
export default async function RepositoriesSettingsPage({ params }: Props) {
  const { locale } = await params;
  await requireAdmin(locale);
  const db = getDb();
  const t = await getTranslations('Settings.repositories');

  const github = listIntegrations(db, 'github')[0] ?? null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      </header>

      <MonitoringCard title={t('safety')}>
        {/* §13's promise, stated where the token is asked for rather than buried in documentation. */}
        <p className="text-sm">{t('readOnly')}</p>
      </MonitoringCard>

      <RepositoriesForm
        save={saveRepositoryAction.bind(null, locale)}
        remove={deleteRepositoryAction.bind(null, locale)}
        saveToken={saveTokenAction.bind(null, locale)}
        repositories={listRepositories(db).map((repository) => ({
          id: repository.id,
          owner: repository.owner,
          name: repository.name,
          defaultBranch: repository.defaultBranch,
        }))}
        hasToken={github?.hasCredential ?? false}
        tokenStatus={github?.status ?? 'untested'}
        tokenError={github?.lastError ?? null}
      />
    </div>
  );
}
