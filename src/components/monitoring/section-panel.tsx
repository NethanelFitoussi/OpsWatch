'use client';

import {
  BellRing,
  ChartColumn,
  ClipboardCheck,
  FileText,
  FolderTree,
  HeartPulse,
  LayoutDashboard,
  LayoutList,
  Lightbulb,
  PanelLeftClose,
  PanelLeftOpen,
  Radar,
  Rocket,
  Route,
  Search,
  Server,
  Siren,
  Sparkles,
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

/** One icon per sub-page kind, so every entry reads at a glance — and, collapsed, reads at all. */
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
  alerts: BellRing,
  incidents: Siren,
  synthetics: Radar,
  ask: Sparkles,
  deployments: Rocket,
  sources: FolderTree,
  estate: LayoutDashboard,
  nodes: Server,
};

const PANEL_STORAGE_KEY = 'opswatch.sectionNav.collapsed';

/** Whether the section menu is collapsed to icons, remembered per browser. */
function useSectionNavCollapsed(): { collapsed: boolean; toggle: () => void } {
  // Open by default, unlike the main rail: the rail beside it is already down to icons, and a screen
  // whose every menu is a column of glyphs asks the operator to translate before they can read anything.
  const { value, toggle } = useRememberedFlag(PANEL_STORAGE_KEY);
  return { collapsed: value, toggle };
}

/**
 * The second menu of a monitoring section: the section's sub-pages, a fixed column at the far left of
 * the content from 1024 px and a horizontal, scrollable strip above it below that, so nothing overflows
 * at 360 px.
 *
 * It reads as words by default — the main rail is the one that starts collapsed — and collapses to its
 * icons on the control at its foot. Collapsed, every entry stays clickable and every name stays announced
 * and on hover: nothing is hidden, only the words are.
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
            'flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-ring',
            collapsed && 'lg:justify-center lg:px-2',
            active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground',
            link.comingSoon ? 'cursor-not-allowed opacity-60' : 'hover:bg-accent hover:text-accent-foreground',
          );
          // Collapsed, the name is still read aloud and still shown on hover — it is not thrown away.
          // Only the column collapses: below 1024 px the menu is a strip, where words cost no width worth
          // saving and glyphs would cost the operator a translation.
          const label = <span className={collapsed ? 'lg:sr-only' : undefined}>{link.label}</span>;
          return (
            <li key={link.subsection} className="lg:w-full">
              {link.comingSoon ? (
                // No page behind it yet, so it is not a link: it shows where the sub-page will be, and says so.
                <span className={classes} aria-disabled="true" title={collapsed ? link.label : undefined}>
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {label}
                  <span
                    className={cn('ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] tracking-wide uppercase', collapsed && 'lg:sr-only')}
                  >
                    {t('sectionNav.comingSoon')}
                  </span>
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
      {/* At the foot of the column, the same place and the same control as the main rail's own toggle.
          The rule above it is what keeps it from reading as one more sub-page. */}
      {/* The column is what collapses, so the control belongs to the column: on a phone the menu is a
          strip whose words cost nothing, and a control there would only take a third of it. */}
      <div className="hidden shrink-0 lg:mt-3 lg:block lg:w-full lg:border-t lg:border-border/60 lg:pt-3">
        <button
          type="button"
          onClick={toggle}
          aria-pressed={collapsed}
          className={cn(
            'flex w-full items-center gap-2 rounded-md py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring',
            collapsed ? 'justify-center px-2' : 'px-3',
          )}
        >
          {collapsed ? <PanelLeftOpen className="size-4 shrink-0" aria-hidden /> : <PanelLeftClose className="size-4 shrink-0" aria-hidden />}
          <span className={collapsed ? 'sr-only' : undefined}>{collapsed ? t('sectionNav.expand') : t('sectionNav.collapse')}</span>
        </button>
      </div>
    </nav>
  );
}
