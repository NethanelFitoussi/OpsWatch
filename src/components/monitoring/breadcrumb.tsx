import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

/**
 * Where the page sits: its section, the connection it reads and the sub-page. At 360 px the section is
 * dropped so the sub-page, the only part that changes inside a section, is always the one still visible.
 */
export async function MonitoringBreadcrumb({
  sectionLabel,
  connectionName,
  subsectionLabel,
  sectionHref,
}: {
  sectionLabel: string;
  connectionName: string;
  subsectionLabel: string;
  sectionHref: string;
}) {
  const t = await getTranslations('Monitoring.common');
  const separator = (
    <span aria-hidden className="text-muted-foreground/60">
      ›
    </span>
  );
  return (
    <nav aria-label={t('breadcrumb.label')}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <li className="hidden sm:inline-flex sm:items-center sm:gap-1.5">
          <Link href={sectionHref} className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
            {sectionLabel}
          </Link>
          {separator}
        </li>
        <li className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{connectionName}</span>
          {separator}
        </li>
        <li aria-current="page" className="font-medium text-foreground">
          {subsectionLabel}
        </li>
      </ol>
    </nav>
  );
}
