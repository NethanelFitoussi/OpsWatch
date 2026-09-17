import { getTranslations } from 'next-intl/server';
import { initProtectedRoute } from '@/lib/auth/route';
import { createConnectionAction } from '../actions';
import { NewConnectionForm } from './new-connection-form';

type Props = { params: Promise<{ locale: string }> };

export default async function NewConnectionPage({ params }: Props) {
  const { locale } = await initProtectedRoute(params);
  const t = await getTranslations('Wizard');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>
      <NewConnectionForm action={createConnectionAction.bind(null, locale)} />
    </div>
  );
}
