import { Radar } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/** The OpsWatch logo and name, linking to the getting started guide. */
export function BrandLink({ className, labelClassName }: { className?: string; labelClassName?: string }) {
  const t = useTranslations('Common');
  return (
    <Link href="/getting-started" className={cn('flex items-center gap-2 font-semibold', className)}>
      <Radar className="size-5 text-primary" aria-hidden />
      <span className={labelClassName}>{t('appName')}</span>
    </Link>
  );
}
