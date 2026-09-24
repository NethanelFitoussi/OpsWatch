'use client';

import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { usePathname } from '@/i18n/navigation';
import { parseMonitoringPath } from '@/lib/monitoring/shared/paths';
import { CommandPalette } from './search/command-palette';
import { BrandLink } from './brand-link';
import { ConnectionSwitcher, type ShellConnection } from './connection-switcher';
import { LocaleSwitcher } from './locale-switcher';
import { NavList, SignOutForm } from './sidebar';
import { ThemeToggle } from './theme-toggle';

export function TopBar({ signedIn, connections }: { signedIn: boolean; connections?: ShellConnection[] }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  // Search is scoped to the environment the operator is in: a result's context is meaningless without
  // one, and there is nothing to search before a connection exists.
  const selection = parseMonitoringPath(usePathname());
  const environment = selection === null ? null : `${selection.connectionId}:${selection.region}`;

  return (
    <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-4">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label={t('Shell.openMenu')}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Menu className="size-5" aria-hidden />
        </Button>
        {/* The name stays for screen readers on narrow screens, where the icon alone has to fit. */}
        <BrandLink className="shrink-0 md:hidden" labelClassName="sr-only sm:not-sr-only" />
        {connections && <ConnectionSwitcher connections={connections} />}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <CommandPalette environment={environment} />
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </div>
      {open && (
        <nav aria-label={t('Common.nav.mainNavigation')} className="border-t px-4 py-3 md:hidden">
          <NavList onNavigate={() => setOpen(false)} />
          {signedIn && (
            <div className="mt-3 border-t pt-3">
              <SignOutForm />
            </div>
          )}
        </nav>
      )}
    </header>
  );
}
