import { ArrowRight, KeyRound, Server, ShieldCheck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const METHODS = [
  { key: 'role', icon: ShieldCheck, anchor: '#steps', recommended: true },
  { key: 'ambient', icon: Server, anchor: '#ambient', recommended: false },
  { key: 'keys', icon: KeyRound, anchor: '#keys', recommended: false },
] as const;

export async function MethodCards() {
  const t = await getTranslations('GettingStarted.methods');

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {METHODS.map(({ key, icon: Icon, anchor, recommended }) => (
        <Card key={key} className={recommended ? 'border-primary/50 shadow-sm' : undefined}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <Icon className="size-6 text-primary" aria-hidden />
              {recommended && <Badge>{t('role.badge')}</Badge>}
            </div>
            <CardTitle className="pt-2">{t(`${key}.title`)}</CardTitle>
            <CardDescription>{t(`${key}.description`)}</CardDescription>
          </CardHeader>
          <CardContent>
            <a href={anchor} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              {t(`${key}.link`)} <ArrowRight className="size-4" aria-hidden />
            </a>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
