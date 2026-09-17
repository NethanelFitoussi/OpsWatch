import { getTranslations } from 'next-intl/server';
import { SECTION_CARD_SPACING } from '@/components/section-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const BLOCK = 'animate-pulse rounded-md bg-muted';

/** The placeholder of a monitoring card while its AWS data loads; the title is real so the page outline stays. */
export async function CardSkeleton({ title, variant, rows = 3 }: { title: string; variant: 'table' | 'chart' | 'stat'; rows?: number }) {
  const t = await getTranslations('Common');
  return (
    <Card role="status" className={SECTION_CARD_SPACING}>
      <CardHeader>
        <CardTitle className="text-base font-semibold tracking-tight">
          <h2>{title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <span className="sr-only">{t('loading')}</span>
        {variant === 'table' &&
          Array.from({ length: rows }, (_, i) => <div key={i} aria-hidden className={cn(BLOCK, 'h-4 w-full')} />)}
        {variant === 'chart' && <div aria-hidden className={cn(BLOCK, 'h-48 w-full')} />}
        {variant === 'stat' && (
          <>
            <div aria-hidden className={cn(BLOCK, 'h-8 w-24')} />
            <div aria-hidden className={cn(BLOCK, 'h-4 w-40')} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
