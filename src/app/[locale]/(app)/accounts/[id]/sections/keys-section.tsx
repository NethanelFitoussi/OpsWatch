import { getTranslations } from 'next-intl/server';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AppLocale } from '@/i18n/routing';
import type { ConnectionView } from '@/lib/connections/repository';
import { saveAccessKeysAction } from '../../actions';
import { AccessKeysForm } from '../forms';

export async function KeysSection({ view, locale }: { view: ConnectionView; locale: AppLocale }) {
  const t = await getTranslations('AccountDetail.keys');
  return (
    <Card>
      <CardHeader>
        <CardTitle><h2>{t('title')}</h2></CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert><AlertDescription>{t('warning')}</AlertDescription></Alert>
        {view.accessKeyHint && <p className="text-sm">{t('savedHint', { hint: view.accessKeyHint })}</p>}
        {view.keysUnreadable && (
          <Alert variant="destructive"><AlertDescription>{t('unreadable')}</AlertDescription></Alert>
        )}
        <AccessKeysForm action={saveAccessKeysAction.bind(null, locale, view.id)} />
      </CardContent>
    </Card>
  );
}
