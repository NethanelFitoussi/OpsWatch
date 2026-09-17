'use client';

import { useTranslations } from 'next-intl';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('ErrorPage');

  return (
    <AppShell signedIn={false}>
      <Card className="mx-auto max-w-md text-center">
        <CardHeader>
          <CardTitle><h1>{t('title')}</h1></CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap justify-center gap-3">
          <Button type="button" onClick={reset}>{t('retry')}</Button>
          <Button asChild variant="outline">
            <Link href="/accounts">{t('accounts')}</Link>
          </Button>
        </CardContent>
      </Card>
    </AppShell>
  );
}
