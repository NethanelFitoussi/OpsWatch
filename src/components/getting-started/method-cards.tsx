import { ArrowRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { AwsIcon, type AwsIconName } from '@/components/aws-icon';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// The AWS services each method relies on; the card titles do not name them, so the icons carry alt text.
const METHODS: readonly { key: 'role' | 'ambient' | 'keys'; icons: AwsIconName[]; anchor: string; recommended: boolean }[] = [
  { key: 'role', icons: ['cloudformation', 'iam'], anchor: '#steps', recommended: true },
  { key: 'ambient', icons: ['ecs', 'ec2'], anchor: '#ambient', recommended: false },
  { key: 'keys', icons: ['iam'], anchor: '#keys', recommended: false },
];

export async function MethodCards() {
  const t = await getTranslations('GettingStarted.methods');
  const iconNames = await getTranslations('AwsIcons');

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {METHODS.map(({ key, icons, anchor, recommended }) => (
        <Card key={key} className={cn('transition-shadow hover:shadow-md', recommended && 'shadow-sm ring-2 ring-primary/60')}>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <span className="flex gap-1.5">
                {icons.map((icon) => (
                  <AwsIcon key={icon} name={icon} size={32} alt={iconNames(icon)} />
                ))}
              </span>
              {recommended && <Badge>{t('role.badge')}</Badge>}
            </div>
            <CardTitle className="pt-2 text-base font-semibold">{t(`${key}.title`)}</CardTitle>
            <CardDescription>{t(`${key}.description`)}</CardDescription>
          </CardHeader>
          <CardContent>
            <a
              href={anchor}
              className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {t(`${key}.link`)} <ArrowRight className="size-4" aria-hidden />
            </a>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
