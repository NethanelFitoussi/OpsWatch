'use client';

import { LogOut } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Link, usePathname } from '@/i18n/navigation';
import { signOutAction } from '@/lib/auth/actions';
import { cn } from '@/lib/utils';
import { AwsIcon } from './aws-icon';
import { BrandLink } from './brand-link';
import { NAV_ITEMS, isNavActive, navHref, type NavItem } from './nav-items';
import { RailCollapseToggle, useRailCollapsed } from './rail-collapse';

/** The label names the item, so its icon is decorative. */
function NavIcon({ icon: Icon }: { icon: NavItem['icon'] }) {
  if (typeof Icon === 'string') return <AwsIcon name={Icon} size={16} alt="" eager />;
  return <Icon className="size-4 shrink-0" aria-hidden />;
}

export function NavList({ onNavigate, collapsed = false }: { onNavigate?: () => void; collapsed?: boolean }) {
  const t = useTranslations('Common.nav');
  const pathname = usePathname();

  return (
    <ul className="space-y-1">
      {NAV_ITEMS.map((item) => {
        const active = isNavActive(item, pathname);
        const classes = cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring',
          active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground',
          collapsed && 'justify-center px-0',
        );
        const link = (
          <Link href={navHref(item, pathname)} className={classes} aria-current={active ? 'page' : undefined} onClick={onNavigate}>
            <NavIcon icon={item.icon} />
            {/* Collapsed, the label is still the link's accessible name; only its box is gone. */}
            <span className={collapsed ? 'sr-only' : undefined}>{t(item.key)}</span>
          </Link>
        );
        return (
          <li key={item.key}>
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{t(item.key)}</TooltipContent>
              </Tooltip>
            ) : (
              link
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function SignOutForm({ collapsed = false }: { collapsed?: boolean }) {
  const t = useTranslations('Common.nav');
  const locale = useLocale();
  return (
    <form action={signOutAction.bind(null, locale)}>
      <button
        type="submit"
        className={cn(
          'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring',
          collapsed && 'justify-center px-0',
        )}
      >
        <LogOut className="size-4 shrink-0" aria-hidden />
        <span className={collapsed ? 'sr-only' : undefined}>{t('signOut')}</span>
      </button>
    </form>
  );
}

export function Sidebar({ signedIn }: { signedIn: boolean }) {
  const t = useTranslations('Common.nav');
  const { collapsed } = useRailCollapsed();

  return (
    <aside className={cn('hidden shrink-0 border-r bg-sidebar md:block', collapsed ? 'w-16' : 'w-72')}>
      {/* The panel stays in view while a long page scrolls; the aside keeps the background full height. */}
      <div className={cn('sticky top-0 flex h-screen flex-col py-5', collapsed ? 'px-2' : 'px-4')}>
        <BrandLink className={cn('mb-8 text-lg', collapsed ? 'justify-center' : 'px-2')} labelClassName={collapsed ? 'sr-only' : undefined} />
        <nav aria-label={t('mainNavigation')} className="flex-1">
          <NavList collapsed={collapsed} />
        </nav>
        <RailCollapseToggle />
        {signedIn && <SignOutForm collapsed={collapsed} />}
      </div>
    </aside>
  );
}
