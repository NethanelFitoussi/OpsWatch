import { Trash2 } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { AppLocale } from '@/i18n/routing';
import { TONE_BORDER } from '@/lib/ui/tones';
import { deleteConnectionAction } from '../../actions';

export async function DangerZone({ connectionId, locale }: { connectionId: string; locale: AppLocale }) {
  const t = await getTranslations('AccountDetail.danger');
  return (
    <Card className={TONE_BORDER.danger}>
      <CardHeader>
        <CardTitle><h2>{t('title')}</h2></CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={deleteConnectionAction.bind(null, locale, connectionId)}>
          <Button type="submit" variant="destructive">
            <Trash2 className="size-4" aria-hidden /> {t('delete')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
