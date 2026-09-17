import { CircleCheck, CircleX } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export async function SecuritySection() {
  const t = await getTranslations('GettingStarted.security');

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>{t('canTitle')}</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {(['can1', 'can2'] as const).map((key) => (
              <li key={key} className="flex gap-2">
                <CircleCheck className="size-4 shrink-0 text-emerald-600" aria-hidden /> {t(key)}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t('cannotTitle')}</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {(['cannot1', 'cannot2', 'cannot3'] as const).map((key) => (
              <li key={key} className="flex gap-2">
                <CircleX className="size-4 shrink-0 text-red-600" aria-hidden /> {t(key)}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t('externalIdTitle')}</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">{t('externalIdBody')}</CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t('revokeTitle')}</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">{t('revokeBody')}</CardContent>
      </Card>
    </div>
  );
}
