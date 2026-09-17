import { getTranslations } from 'next-intl/server';
import { SectionCard } from '@/components/section-card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { AppLocale } from '@/i18n/routing';
import type { ConnectionView } from '@/lib/connections/repository';
import { saveAccessKeysAction } from '../../actions';
import { AccessKeysForm } from '../forms';

export async function KeysSection({ view, locale }: { view: ConnectionView; locale: AppLocale }) {
  const t = await getTranslations('AccountDetail.keys');
  return (
    <SectionCard title={t('title')} contentClassName="space-y-4">
      <Alert><AlertDescription>{t('warning')}</AlertDescription></Alert>
      {view.accessKeyHint && <p className="text-sm">{t('savedHint', { hint: view.accessKeyHint })}</p>}
      {view.keysUnreadable && (
        <Alert variant="destructive"><AlertDescription>{t('unreadable')}</AlertDescription></Alert>
      )}
      <AccessKeysForm action={saveAccessKeysAction.bind(null, locale, view.id)} />
    </SectionCard>
  );
}
