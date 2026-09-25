import { getTranslations } from 'next-intl/server';
import { PageBody } from '@/components/page-body';
import { PageHeader } from '@/components/page-header';
import { SectionCard } from '@/components/section-card';
import { localizedTitle } from '@/i18n/metadata';
import { initProtectedRoute } from '@/lib/auth/route';
import { DO_SCOPE } from '@/lib/do/check';
import { createDoConnectionAction } from '../../actions';
import { NewDoConnectionForm } from './new-do-connection-form';

type Props = { params: Promise<{ locale: string }> };

export const generateMetadata = localizedTitle('DoWizard.title');

/**
 * Connecting a DigitalOcean account.
 *
 * What the token needs is on the page before the field it goes in, and it is deliberately the narrow
 * one. DigitalOcean offers `api:read`, which is "read everything this team can see", and a custom
 * `droplet:read`, which is "read the droplets" — a product that asks for the first when it uses the
 * second is asking for access it has no plan for.
 */
export default async function NewDoConnectionPage({ params }: Props) {
  const { locale } = await initProtectedRoute(params);
  const t = await getTranslations('DoWizard');

  return (
    <PageBody>
      <PageHeader title={t('title')} description={t('description')} />

      <SectionCard title={t('accessTitle')} description={t('accessHint')}>
        <p className="text-sm">
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{DO_SCOPE}</code> — {t('scope')}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">{t('notApiRead')}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t('stored')}</p>
      </SectionCard>

      <NewDoConnectionForm action={createDoConnectionAction.bind(null, locale)} />
    </PageBody>
  );
}
