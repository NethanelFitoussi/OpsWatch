import { getTranslations } from 'next-intl/server';

const ITEMS = ['overview', 'containers', 'databases', 'loadBalancers', 'alarms'] as const;

export async function PagesSection() {
  const t = await getTranslations('GettingStarted.pages');

  return (
    <div className="space-y-4">
      <ul className="list-disc space-y-2 pl-5">
        {ITEMS.map((key) => (
          <li key={key}>{t(`items.${key}`)}</li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">{t('refresh')}</p>
    </div>
  );
}
