import { Trash2 } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { SectionCard } from '@/components/section-card';
import type { AppLocale } from '@/i18n/routing';
import { TONE_BORDER } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';
import { deleteConnectionAction } from '../../actions';

/**
 * Disconnecting an account, with what it actually does written out first.
 *
 * `managed` is passed in rather than read here because it changes the list: with forwarding on, removing
 * the connection also stops the forwarding, and an operator who is not told that will leave a Lambda
 * running against subscriptions pointing at an integration that no longer exists.
 */
export async function DangerZone({ connectionId, locale, managed = false }: { connectionId: string; locale: AppLocale; managed?: boolean }) {
  const t = await getTranslations('AccountDetail.danger');
  return (
    <SectionCard
      title={t('title')}
      description={t('description')}
      className={cn('ring-0 border', TONE_BORDER.danger)}
      action={
        <form action={deleteConnectionAction.bind(null, locale, connectionId)}>
          <Button type="submit" variant="destructive">
            <Trash2 className="size-4" aria-hidden /> {t('delete')}
          </Button>
        </form>
      }
    >
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>{t('stopsCollection')}</li>
        <li>{t('removesCredentials')}</li>
        {managed && <li className="font-medium text-foreground">{t('stopsForwarding')}</li>}
        {/* The part OpsWatch cannot do for them, said plainly rather than left to be discovered. */}
        <li>{managed ? t('deleteBothStacks') : t('deleteStack')}</li>
      </ul>
    </SectionCard>
  );
}
