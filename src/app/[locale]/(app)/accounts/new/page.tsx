import { getTranslations } from 'next-intl/server';
import { PageBody } from '@/components/page-body';
import { PageHeader } from '@/components/page-header';
import { localizedTitle } from '@/i18n/metadata';
import { initProtectedRoute } from '@/lib/auth/route';
import { createConnectionAction } from '../actions';
import { NewConnectionForm } from './new-connection-form';

type Props = { params: Promise<{ locale: string }> };

export const generateMetadata = localizedTitle('Wizard.title');

export default async function NewConnectionPage({ params }: Props) {
  const { locale } = await initProtectedRoute(params);
  const t = await getTranslations('Wizard');

  return (
    <PageBody>
      <PageHeader title={t('title')} description={t('description')} />
      <NewConnectionForm action={createConnectionAction.bind(null, locale)} />
    </PageBody>
  );
}
