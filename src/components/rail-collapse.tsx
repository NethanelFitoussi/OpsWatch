'use client';

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRememberedFlag } from './use-remembered-flag';

const RAIL_STORAGE_KEY = 'opswatch.rail.collapsed';

/** Whether the main rail is collapsed to icons, remembered per browser. */
export function useRailCollapsed(): { collapsed: boolean; toggle: () => void } {
  const { value, toggle } = useRememberedFlag(RAIL_STORAGE_KEY);
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
