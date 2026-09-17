'use client';

import { LogOut, Radar } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { signOutAction } from '@/lib/auth/actions';
import { cn } from '@/lib/utils';
import { NAV_ITEMS } from './nav-items';

export function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('Common.nav');
  const pathname = usePathname();

  return (
    <ul className="space-y-1">
      {NAV_ITEMS.map(({ key, href, icon: Icon, enabled }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const classes = cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm',
          active ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground',
          enabled ? 'hover:bg-accent hover:text-accent-foreground' : 'cursor-not-allowed opacity-60',
        );
        return (
          <li key={key}>
            {enabled ? (
              <Link href={href} className={classes} aria-current={active ? 'page' : undefined} onClick={onNavigate}>
                <Icon className="size-4" aria-hidden />
                {t(key)}
              </Link>
            ) : (
              <span className={classes} aria-disabled="true">
                <Icon className="size-4" aria-hidden />
                {t(key)}
                <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide">
                  {t('comingSoon')}
                </span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Sidebar({ signedIn }: { signedIn: boolean }) {
  const t = useTranslations();
  const locale = useLocale();

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar px-4 py-5 md:flex">
      <Link href="/getting-started" className="mb-8 flex items-center gap-2 px-3 text-lg font-semibold">
        <Radar className="size-5 text-primary" aria-hidden />
        {t('Common.appName')}
      </Link>
      <nav aria-label={t('Common.nav.mainNavigation')} className="flex-1">
        <NavList />
      </nav>
      {signedIn && (
        <form action={signOutAction.bind(null, locale)}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <LogOut className="size-4" aria-hidden />
            {t('Common.nav.signOut')}
          </button>
        </form>
      )}
    </aside>
  );
}
