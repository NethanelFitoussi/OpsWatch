'use client';

import { Menu, Radar } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { ConnectionSwitcher, type ShellConnection } from './connection-switcher';
import { LocaleSwitcher } from './locale-switcher';
import { NavList, SignOutForm } from './sidebar';
import { ThemeToggle } from './theme-toggle';

export function TopBar({ signedIn, connections }: { signedIn: boolean; connections?: ShellConnection[] }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

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
        <Link href="/getting-started" className="flex items-center gap-2 font-semibold md:hidden">
          <Radar className="size-5 text-primary" aria-hidden />
          {t('Common.appName')}
        </Link>
        {connections && <ConnectionSwitcher connections={connections} />}
        <div className="ml-auto flex items-center gap-2">
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
