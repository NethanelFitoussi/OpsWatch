import { getTranslations } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { getCurrentAdminId } from '@/lib/auth/current';

export default async function NotFound() {
  const t = await getTranslations('NotFound');
  const signedIn = (await getCurrentAdminId()) !== null;

  return (
    <AppShell signedIn={signedIn}>
      <Card className="mx-auto max-w-md text-center">
        <CardHeader>
          <CardTitle><h1>{t('title')}</h1></CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link href="/accounts">{t('accounts')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/getting-started">{t('guide')}</Link>
          </Button>
        </CardContent>
      </Card>
    </AppShell>
  );
}
