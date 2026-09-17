import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/current';
import { createConnectionAction } from '../actions';
import { NewConnectionForm } from './new-connection-form';

type Props = { params: Promise<{ locale: string }> };

export default async function NewConnectionPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  // The (app) layout also checks, but a layout does not stop this segment from rendering in an RSC request.
  await requireAdmin(locale);
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
