import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { redirect } from '@/i18n/navigation';
import { hasAdmin } from '@/lib/auth/admin';
import { getDb } from '@/lib/db/client';
import { setupAction } from './actions';
import { SetupForm } from './setup-form';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }> };

export default async function SetupPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (hasAdmin(getDb())) {
    redirect({ href: '/login', locale });
  }
  const t = await getTranslations('Auth.setup');

  return (
    <AppShell signedIn={false}>
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle><h1>{t('title')}</h1></CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <SetupForm action={setupAction.bind(null, locale)} />
        </CardContent>
      </Card>
    </AppShell>
  );
}
