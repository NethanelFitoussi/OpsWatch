'use client';

import { useTranslations } from 'next-intl';
import { AppShell } from '@/components/app-shell';
import { MessageCard } from '@/components/message-card';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { titleTemplate } from '@/i18n/title';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('ErrorPage');
  const common = useTranslations('Common');

  return (
    <AppShell signedIn={false}>
      {/* Error boundaries are client components and cannot export metadata; React places this title in the head. */}
      <title>{titleTemplate(common('appName'), t('title'))}</title>
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
