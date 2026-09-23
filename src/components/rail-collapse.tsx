'use client';

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRememberedFlag } from './use-remembered-flag';

const RAIL_STORAGE_KEY = 'opswatch.rail.collapsed';

/**
 * Whether the main rail is collapsed to icons, remembered per browser.
 *
 * It starts collapsed. The sections are a short, fixed set an operator learns on the first day, and 288 px
 * of them beside every page is width taken from the thing they opened OpsWatch to read. Collapsed is not
 * hidden: every entry keeps its icon, its tooltip and its accessible name, and one control at the foot
 * opens it for good — `true` here is the default, not a stored value, so an operator who opens it is
 * remembered.
 */
export function useRailCollapsed(): { collapsed: boolean; toggle: () => void } {
  const { value, toggle } = useRememberedFlag(RAIL_STORAGE_KEY, true);
  return { collapsed: value, toggle };
}

export function RailCollapseToggle() {
  const t = useTranslations('Shell');
  const { collapsed, toggle } = useRailCollapsed();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={collapsed}
      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      {collapsed ? <PanelLeftOpen className="size-4 shrink-0" aria-hidden /> : <PanelLeftClose className="size-4 shrink-0" aria-hidden />}
      <span className={collapsed ? 'sr-only' : undefined}>{collapsed ? t('rail.expand') : t('rail.collapse')}</span>
    </button>
  );
}
