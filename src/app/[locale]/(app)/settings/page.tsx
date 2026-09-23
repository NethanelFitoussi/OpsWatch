import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { PageBody } from '@/components/page-body';
import { PageHeader } from '@/components/page-header';
import { localizedTitle } from '@/i18n/metadata';
import { initProtectedRoute } from '@/lib/auth/route';
import { getDb } from '@/lib/db/client';
import { appSettings } from '@/lib/settings/repository';
import { saveSettingsAction } from './actions';
import { SettingsForm } from './settings-form';

type Props = { params: Promise<{ locale: string }> };

export const generateMetadata = localizedTitle('Settings.title');

/** The settings that live on their own page, listed here because the rail has one Settings entry, not three. */
const MORE_SETTINGS = [
  { key: 'integrations', href: '/settings/integrations' },
  { key: 'history', href: '/settings/history' },
  { key: 'repositories', href: '/settings/repositories' },
  { key: 'ai', href: '/settings/ai' },
  { key: 'audit', href: '/settings/audit' },
  { key: 'status', href: '/settings/status' },
] as const;

/** The instance's settings. Not a monitoring section: no connection and no region in its URL. */
export default async function SettingsPage({ params }: Props) {
  const { locale } = await initProtectedRoute(params);
  const t = await getTranslations('Settings');
  return (
    <PageBody>
      <PageHeader title={t('title')} description={t('description')} />
      <SettingsForm action={saveSettingsAction.bind(null, locale)} current={appSettings.read(getDb())} />

      {/* Both pages existed before anything linked to them, which made them unreachable to a real user. */}
      <MonitoringCard title={t('more.title')}>
        <ul className="flex flex-col gap-3">
          {MORE_SETTINGS.map((entry) => (
            <li key={entry.href}>
              <Link href={entry.href} className="text-sm font-medium underline-offset-4 hover:underline">
                {t(`more.${entry.key}`)}
              </Link>
              <p className="text-sm text-muted-foreground">{t(`more.${entry.key}Hint`)}</p>
            </li>
          ))}
        </ul>
      </MonitoringCard>
    </PageBody>
  );
}
