import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { CenteredCard } from '@/components/centered-card';
import { localizedTitle } from '@/i18n/metadata';
import { redirect } from '@/i18n/navigation';
import { hasAdmin } from '@/lib/auth/admin';
import { getDb } from '@/lib/db/client';
import { setupAction } from './actions';
import { SetupForm } from './setup-form';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }> };

export const generateMetadata = localizedTitle('Auth.setup.title');

export default async function SetupPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (hasAdmin(getDb())) {
    redirect({ href: '/login', locale });
  }
  const t = await getTranslations('Auth.setup');

  return (
    <AppShell signedIn={false}>
      <CenteredCard title={t('title')} description={t('description')}>
        <SetupForm action={setupAction.bind(null, locale)} />
      </CenteredCard>
    </AppShell>
  );
}
