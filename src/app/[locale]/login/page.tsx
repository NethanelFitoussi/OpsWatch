import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { CenteredCard } from '@/components/centered-card';
import { localizedTitle } from '@/i18n/metadata';
import { redirect } from '@/i18n/navigation';
import { hasAdmin } from '@/lib/auth/admin';
import { getCurrentAdminId } from '@/lib/auth/current';
import { getDb } from '@/lib/db/client';
import { loginAction } from './actions';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }> };

export const generateMetadata = localizedTitle('Auth.login.title');

export default async function LoginPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!hasAdmin(getDb())) {
    redirect({ href: '/setup', locale });
  }
  if ((await getCurrentAdminId()) !== null) {
    redirect({ href: '/accounts', locale });
  }
  const t = await getTranslations('Auth.login');

  return (
    <AppShell signedIn={false}>
      <CenteredCard title={t('title')} description={t('description')}>
        <LoginForm action={loginAction.bind(null, locale)} />
      </CenteredCard>
    </AppShell>
  );
}
