import { getTranslations } from 'next-intl/server';
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

/** The instance's settings. Not a monitoring section: no connection and no region in its URL. */
export default async function SettingsPage({ params }: Props) {
  const { locale } = await initProtectedRoute(params);
  const t = await getTranslations('Settings');
  return (
    <PageBody>
      <PageHeader title={t('title')} description={t('description')} />
      <SettingsForm action={saveSettingsAction.bind(null, locale)} current={appSettings.read(getDb())} />
    </PageBody>
  );
}
