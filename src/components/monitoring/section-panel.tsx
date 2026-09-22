'use client';

import {
  ChartColumn,
  ClipboardCheck,
  FileText,
  HeartPulse,
  LayoutList,
  Lightbulb,
  Route,
  Search,
  Sunrise,
  Table2,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { SUBSECTION_ICONS } from '@/lib/monitoring/shared/sections';
import { cn } from '@/lib/utils';

export type SectionLink = { subsection: string; href: string; label: string; comingSoon: boolean };

/** One icon per sub-page kind, so every entry reads at a glance. */
const ICONS: Record<string, LucideIcon> = {
  problems: TriangleAlert,
  health: HeartPulse,
  brief: Sunrise,
  insights: Lightbulb,
  audit: ClipboardCheck,
  list: LayoutList,
  report: FileText,
  queries: Table2,
  search: Search,
  volume: ChartColumn,
  endpoints: Route,
};

/**
 * The second menu of a monitoring section: the section's sub-pages, a fixed column at the far left of
 * the content from 1024 px and a horizontal, scrollable strip above it below that, so nothing overflows
 * at 360 px. It does not collapse on its own — the main rail is what collapses, with one control at its
 * foot — so its entries always read as words.
 */
export function SectionPanel({ sectionLabel, subsection, links }: { sectionLabel: string; subsection: string; links: SectionLink[] }) {
  const t = useTranslations('Monitoring.client');

  return (
    <nav aria-label={t('sectionNav.label', { section: sectionLabel })} className="min-w-0 lg:sticky lg:top-20 lg:w-56 lg:px-2">
      <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-x-visible lg:pb-0">
        {links.map((link) => {
          const Icon = ICONS[SUBSECTION_ICONS[link.subsection]] ?? LayoutList;
          const active = link.subsection === subsection;
          const classes = cn(
            'flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-ring',
            active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground',
            link.comingSoon ? 'cursor-not-allowed opacity-60' : 'hover:bg-accent hover:text-accent-foreground',
          );
          return (
            <li key={link.subsection} className="lg:w-full">
              {link.comingSoon ? (
                // No page behind it yet, so it is not a link: it shows where the sub-page will be, and says so.
                <span className={classes} aria-disabled="true">
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {link.label}
                  <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] tracking-wide uppercase">{t('sectionNav.comingSoon')}</span>
                </span>
              ) : (
                <Link href={link.href} aria-current={active ? 'page' : undefined} className={classes}>
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {link.label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
