'use client';

import {
  ChartColumn,
  ClipboardCheck,
  FileText,
  LayoutList,
  Lightbulb,
  PanelLeftClose,
  PanelLeftOpen,
  Route,
  Search,
  Table2,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useRememberedFlag } from '@/components/use-remembered-flag';
import { Link } from '@/i18n/navigation';
import { SUBSECTION_ICONS } from '@/lib/monitoring/shared/sections';
import { cn } from '@/lib/utils';

const SECTION_PANEL_STORAGE_KEY = 'opswatch.sectionPanel.collapsed';

export type SectionLink = { subsection: string; href: string; label: string; comingSoon: boolean };

/** One icon per sub-page kind, so the collapsed panel still names every entry. */
const ICONS: Record<string, LucideIcon> = {
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
 * The second menu of a monitoring section: the section's sub-pages, vertical beside the content from
 * 1024 px and a horizontal, scrollable strip below it, so nothing overflows at 360 px. Collapsing it to
 * icons is remembered per browser; the collapse control only exists in the vertical layout.
 */
export function SectionPanel({ sectionLabel, subsection, links }: { sectionLabel: string; subsection: string; links: SectionLink[] }) {
  const t = useTranslations('Monitoring.client');
  // Expanded until the browser's choice has been read, so the server HTML and the first client render agree.
  const { value: collapsed, toggle } = useRememberedFlag(SECTION_PANEL_STORAGE_KEY);

  return (
    <nav
      aria-label={t('sectionNav.label', { section: sectionLabel })}
      className={cn('min-w-0 lg:sticky lg:top-6 lg:shrink-0', collapsed ? 'lg:w-14' : 'lg:w-56')}
    >
      <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-x-visible lg:pb-0">
        {links.map((link) => {
          const Icon = ICONS[SUBSECTION_ICONS[link.subsection]] ?? LayoutList;
          const active = link.subsection === subsection;
          const classes = cn(
            'flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-ring',
            active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground',
            link.comingSoon ? 'cursor-not-allowed opacity-60' : 'hover:bg-accent hover:text-accent-foreground',
            collapsed && 'lg:justify-center lg:px-0',
          );
          // Collapsed, the label is still the entry's accessible name; only its box is gone.
          const label = <span className={cn(collapsed && 'lg:sr-only')}>{link.label}</span>;
          const item = link.comingSoon ? (
            // No page behind it yet, so it is not a link: it shows where the sub-page will be, and says so.
            <span className={classes} aria-disabled="true">
              <Icon className="size-4 shrink-0" aria-hidden />
              {label}
              <span className={cn('ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] tracking-wide uppercase', collapsed && 'lg:sr-only')}>
                {t('sectionNav.comingSoon')}
              </span>
            </span>
          ) : (
            <Link href={link.href} aria-current={active ? 'page' : undefined} className={classes}>
              <Icon className="size-4 shrink-0" aria-hidden />
              {label}
            </Link>
          );
          return (
            <li key={link.subsection} className="lg:w-full">
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>{item}</TooltipTrigger>
                  <TooltipContent side="right">{link.comingSoon ? t('sectionNav.comingSoonFor', { page: link.label }) : link.label}</TooltipContent>
                </Tooltip>
              ) : (
                item
              )}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={collapsed}
        className={cn(
          'mt-2 hidden w-full items-center gap-2 border-t border-border/60 px-3 pt-3 pb-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring lg:flex',
          collapsed && 'lg:justify-center lg:px-0',
        )}
      >
        {collapsed ? <PanelLeftOpen className="size-4 shrink-0" aria-hidden /> : <PanelLeftClose className="size-4 shrink-0" aria-hidden />}
        <span className={cn(collapsed && 'lg:sr-only')}>{collapsed ? t('sectionNav.expand') : t('sectionNav.collapse')}</span>
      </button>
    </nav>
  );
}
