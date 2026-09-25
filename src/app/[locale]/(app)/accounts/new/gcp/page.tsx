import { getTranslations } from 'next-intl/server';
import { PageBody } from '@/components/page-body';
import { PageHeader } from '@/components/page-header';
import { SectionCard } from '@/components/section-card';
import { localizedTitle } from '@/i18n/metadata';
import { initProtectedRoute } from '@/lib/auth/route';
import { GCP_ROLES } from '@/lib/gcp/check';
import { createGoogleConnectionAction } from '../../actions';
import { NewGoogleConnectionForm } from './new-google-connection-form';

type Props = { params: Promise<{ locale: string }> };

export const generateMetadata = localizedTitle('GoogleWizard.title');

/**
 * Connecting a Google Cloud project.
 *
 * What OpsWatch will be able to read is on the page **before** the form, in the roles an operator will
 * recognise and can check against their own policy. Asking first and explaining afterwards is asking
 * somebody to agree to something they have not read.
 *
 * The form asks only for names: a project, a pool, a provider, and optionally a service account. None
 * of it is a secret, because OpsWatch never holds a Google credential — it signs its own token and
 * exchanges it, which is the method Google recommends over the service account keys it discourages.
 */
export default async function NewGoogleConnectionPage({ params }: Props) {
  const { locale } = await initProtectedRoute(params);
  const t = await getTranslations('GoogleWizard');

  return (
    <PageBody>
      <PageHeader title={t('title')} description={t('description')} />

      <SectionCard title={t('accessTitle')} description={t('accessHint')}>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {GCP_ROLES.map((role) => (
            <li key={role}>
              <code className="font-mono text-xs">{role}</code> — {t(`roles.${role === 'roles/compute.viewer' ? 'compute' : 'monitoring'}`)}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm">{t('noKey')}</p>
      </SectionCard>

      <NewGoogleConnectionForm action={createGoogleConnectionAction.bind(null, locale)} />
    </PageBody>
  );
}
