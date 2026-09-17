import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { redirect } from '@/i18n/navigation';
import { hasAdmin } from '@/lib/auth/admin';
import { getCurrentAdminId } from '@/lib/auth/current';
import { getDb } from '@/lib/db/client';
import { loginAction } from './actions';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }> };

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
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle><h1>{t('title')}</h1></CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm action={loginAction.bind(null, locale)} />
        </CardContent>
      </Card>
    </AppShell>
  );
}
