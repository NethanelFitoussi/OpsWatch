import { getTranslations, setRequestLocale } from 'next-intl/server';

type Props = { params: Promise<{ locale: string }> };

export default async function GettingStartedPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Common');
  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="text-3xl font-semibold">{t('appName')}</h1>
      <p className="mt-2 text-muted-foreground">{t('tagline')}</p>
    </main>
  );
}
