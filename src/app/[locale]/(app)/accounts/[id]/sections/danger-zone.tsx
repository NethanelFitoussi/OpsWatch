import { Trash2 } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { SectionCard } from '@/components/section-card';
import type { AppLocale } from '@/i18n/routing';
import { TONE_BORDER } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';
import { deleteConnectionAction } from '../../actions';

export async function DangerZone({ connectionId, locale }: { connectionId: string; locale: AppLocale }) {
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
    />
  );
}
