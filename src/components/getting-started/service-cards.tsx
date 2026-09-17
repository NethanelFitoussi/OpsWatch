import { getTranslations } from 'next-intl/server';
import { SERVICE_ICONS, ServiceIconImage } from '@/components/aws-icon';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SERVICE_GROUPS } from '@/lib/aws/actions';

export async function ServiceCards() {
  const t = await getTranslations('GettingStarted.serviceCards');
  const services = await getTranslations('Services');

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {SERVICE_GROUPS.map((group) => (
        <Card key={group.id}>
          <CardHeader className="flex items-center gap-3">
            <span className="flex shrink-0 gap-1.5">
              {SERVICE_ICONS[group.id].map((icon, index) => (
                <ServiceIconImage key={index} icon={icon} size={36} />
              ))}
            </span>
            <CardTitle className="text-base font-semibold">{services(group.id)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <dl className="space-y-2">
              <div>
                <dt className="font-medium">{t('why')}</dt>
                <dd className="text-muted-foreground">{t(`groups.${group.id}.why`)}</dd>
              </div>
              <div>
                <dt className="font-medium">{t('unlocks')}</dt>
                <dd className="text-muted-foreground">{t(`groups.${group.id}.unlocks`)}</dd>
              </div>
              <div>
                <dt className="font-medium">{t('without')}</dt>
                <dd className="text-muted-foreground">{t(`groups.${group.id}.without`)}</dd>
              </div>
            </dl>
            <div>
              <p className="mb-1 font-medium">{t('actions')}</p>
              <ul className="flex flex-wrap gap-1.5">
                {group.actions.map((action) => (
                  <li key={action}>
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{action}</code>
                  </li>
                ))}
              </ul>
            </div>
            {group.billedActions.map((action) => (
              <p key={action} className="rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                {t('billed', { action })}
              </p>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
