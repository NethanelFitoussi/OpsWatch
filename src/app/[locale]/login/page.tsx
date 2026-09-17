import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { CenteredCard } from '@/components/centered-card';
import { localizedTitle } from '@/i18n/metadata';
import { redirect } from '@/i18n/navigation';
import { hasAdmin } from '@/lib/auth/admin';
import { getCurrentAdminId } from '@/lib/auth/current';
import { GOOGLE_SIGN_IN_ERRORS, googleSignInConfig } from '@/lib/auth/google';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';
import { loginAction, type LoginState } from './actions';
import { GoogleSignIn } from './google-sign-in';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ error?: string | string[] }> };

/** Errors a redirect to this page may carry in `?error=`: the Google sign-in ones and the login limit. */
const REDIRECT_ERRORS: readonly string[] = [...GOOGLE_SIGN_IN_ERRORS, 'rate_limited'];

function redirectError(value: string | string[] | undefined): LoginState['error'] {
  return typeof value === 'string' && REDIRECT_ERRORS.includes(value) ? (value as LoginState['error']) : undefined;
}

export const generateMetadata = localizedTitle('Auth.login.title');

export default async function LoginPage({ params, searchParams }: Props) {
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
        {googleSignInConfig(env()) && <GoogleSignIn locale={locale} label={t('google')} separator={t('or')} />}
        <LoginForm action={loginAction.bind(null, locale)} initialError={redirectError((await searchParams).error)} />
      </CenteredCard>
    </AppShell>
  );
}
