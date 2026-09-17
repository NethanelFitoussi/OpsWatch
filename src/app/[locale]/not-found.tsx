import { getTranslations } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { MessageCard } from '@/components/message-card';
import { Button } from '@/components/ui/button';
import { titleTemplate } from '@/i18n/title';
import { Link } from '@/i18n/navigation';
import { getCurrentAdminId } from '@/lib/auth/current';

export default async function NotFound() {
  const t = await getTranslations('NotFound');
  const common = await getTranslations('Common');
  const signedIn = (await getCurrentAdminId()) !== null;

  return (
    <AppShell signedIn={signedIn}>
      {/* not-found files cannot export metadata; React places this title in the document head. */}
      <title>{titleTemplate(common('appName'), t('title'))}</title>
      <MessageCard
        title={t('title')}
        description={t('description')}
        actions={
          <>
            <Button asChild>
              <Link href="/accounts">{t('accounts')}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/getting-started">{t('guide')}</Link>
            </Button>
          </>
        }
      />
    </AppShell>
  );
}
