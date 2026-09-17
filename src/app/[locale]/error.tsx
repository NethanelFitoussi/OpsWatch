'use client';

import { useTranslations } from 'next-intl';
import { AppShell } from '@/components/app-shell';
import { MessageCard } from '@/components/message-card';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('ErrorPage');

  return (
    <AppShell signedIn={false}>
      <MessageCard
        title={t('title')}
        description={t('description')}
        actions={
          <>
            <Button type="button" onClick={reset}>{t('retry')}</Button>
            <Button asChild variant="outline">
              <Link href="/accounts">{t('accounts')}</Link>
            </Button>
          </>
        }
      />
    </AppShell>
  );
}
