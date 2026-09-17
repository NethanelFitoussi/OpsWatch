import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { LogoMark } from './logo-mark';

/** The OpsWatch logo and name, linking to the getting started guide. */
export function BrandLink({ className, labelClassName }: { className?: string; labelClassName?: string }) {
  const t = useTranslations('Common');
  return (
    <Link
      href="/getting-started"
      className={cn(
        'flex items-center gap-2.5 rounded-md font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        className,
      )}
    >
      <LogoMark className="size-7" />
      <span className={labelClassName}>{t('appName')}</span>
    </Link>
  );
}
