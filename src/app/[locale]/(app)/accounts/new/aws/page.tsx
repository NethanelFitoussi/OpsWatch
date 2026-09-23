import { getTranslations } from 'next-intl/server';
import { PageBody } from '@/components/page-body';
import { PageHeader } from '@/components/page-header';
import { localizedTitle } from '@/i18n/metadata';
import { initProtectedRoute } from '@/lib/auth/route';
import { createConnectionAction } from '../../actions';
import { NewConnectionForm } from './new-connection-form';

type Props = { params: Promise<{ locale: string }> };

export const generateMetadata = localizedTitle('Wizard.title');

/**
 * Connecting an AWS account.
 *
 * Reached from the chooser at `/accounts/new`, which asks what an operator wants to connect before assuming
 * they mean AWS. This page is unchanged otherwise: the onboarding that existed keeps working exactly as it
 * did, and the chooser is a step in front of it rather than a rewrite of it.
 */
export default async function NewAwsConnectionPage({ params }: Props) {
  const { locale } = await initProtectedRoute(params);
  const t = await getTranslations('Wizard');

  return (
    <PageBody>
      <PageHeader title={t('title')} description={t('description')} />
      <NewConnectionForm action={createConnectionAction.bind(null, locale)} />
    </PageBody>
  );
}
