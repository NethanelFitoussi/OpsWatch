import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

/** Shown while OpsWatch's own AWS identity is looked up, which can take up to 5 seconds. */
export async function IdentitySkeleton({ cards = 1 }: { cards?: number }) {
  const t = await getTranslations('Common');
  return (
    <div role="status" className="space-y-6">
      <span className="sr-only">{t('loading')}</span>
      {Array.from({ length: cards }, (_, index) => (
        <Card key={index} aria-hidden>
          <CardHeader>
            <div className="h-5 w-48 animate-pulse rounded-md bg-muted" />
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="h-4 w-full animate-pulse rounded-md bg-muted" />
            <div className="h-4 w-2/3 animate-pulse rounded-md bg-muted" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
