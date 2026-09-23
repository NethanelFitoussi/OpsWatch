'use client';

import {
  ChartColumn,
  ClipboardCheck,
  FileText,
  HeartPulse,
  LayoutList,
  Lightbulb,
  PanelLeftClose,
  PanelLeftOpen,
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
import { useRememberedFlag } from '../use-remembered-flag';

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

const PANEL_STORAGE_KEY = 'opswatch.sectionNav.collapsed';

/** Whether the section menu is collapsed to icons. Collapsed until an operator says otherwise. */
function useSectionNavCollapsed(): { collapsed: boolean; toggle: () => void } {
  // `true` is the fallback, not a stored value: an operator who expands the menu is remembered, and an
  // operator who has never touched it gets the width back for the page they came here to read.
  const { value, toggle } = useRememberedFlag(PANEL_STORAGE_KEY, true);
  return { collapsed: value, toggle };
}

/**
 * The second menu of a monitoring section: the section's sub-pages, a fixed column at the far left of
 * the content from 1024 px and a horizontal, scrollable strip above it below that, so nothing overflows
 * at 360 px.
 *
 * It starts collapsed to its icons, because the sub-pages are a short, stable set an operator learns in
 * a day, and the page beside it is what they opened OpsWatch to read. Every entry stays clickable while
 * collapsed — nothing is hidden, only the words are — and the page's own header names where you are, so
 * the collapsed state never leaves the question "which page is this" unanswered.
 */
export function SectionPanel({ sectionLabel, subsection, links }: { sectionLabel: string; subsection: string; links: SectionLink[] }) {
  const t = useTranslations('Monitoring.client');
  const { collapsed, toggle } = useSectionNavCollapsed();

  return (
    <nav
      aria-label={t('sectionNav.label', { section: sectionLabel })}
      className={cn('flex min-w-0 items-center gap-1 lg:sticky lg:top-20 lg:flex-col lg:items-stretch lg:px-2', collapsed ? 'lg:w-14' : 'lg:w-56')}
    >
      <ul className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-1 lg:w-full lg:flex-none lg:flex-col lg:overflow-x-visible lg:pb-0">
        {links.map((link) => {
          const Icon = ICONS[SUBSECTION_ICONS[link.subsection]] ?? LayoutList;
          const active = link.subsection === subsection;
          const classes = cn(
            'flex items-center gap-2 rounded-md py-2 text-sm whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-ring',
            collapsed ? 'justify-center px-2' : 'px-3',
            active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground',
            link.comingSoon ? 'cursor-not-allowed opacity-60' : 'hover:bg-accent hover:text-accent-foreground',
          );
          // Collapsed, the name is still read aloud and still shown on hover — it is not thrown away.
          const label = (
            <span className={collapsed ? 'sr-only' : undefined}>
              {link.label}
              {collapsed && link.comingSoon ? ` — ${t('sectionNav.comingSoon')}` : ''}
            </span>
          );
          return (
            <li key={link.subsection} className="lg:w-full">
              {link.comingSoon ? (
                // No page behind it yet, so it is not a link: it shows where the sub-page will be, and says so.
                <span className={classes} aria-disabled="true" title={collapsed ? link.label : undefined}>
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {label}
                  {!collapsed && (
                    <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] tracking-wide uppercase">{t('sectionNav.comingSoon')}</span>
                  )}
                </span>
              ) : (
                <Link href={link.href} aria-current={active ? 'page' : undefined} className={classes} title={collapsed ? link.label : undefined}>
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {/* At the end of the strip below 1024 px and at the foot of the column above it — the same place,
          and the same control, as the main rail's own toggle. */}
      <button
        type="button"
        onClick={toggle}
        aria-pressed={collapsed}
        className={cn(
          'flex shrink-0 items-center gap-2 rounded-md py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring lg:mt-1 lg:w-full',
          collapsed ? 'justify-center px-2' : 'px-3',
        )}
      >
        {collapsed ? <PanelLeftOpen className="size-4 shrink-0" aria-hidden /> : <PanelLeftClose className="size-4 shrink-0" aria-hidden />}
        <span className={collapsed ? 'sr-only' : undefined}>{collapsed ? t('sectionNav.expand') : t('sectionNav.collapse')}</span>
      </button>
    </nav>
  );
}
