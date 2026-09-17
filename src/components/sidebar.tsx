'use client';

import { LogOut } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { signOutAction } from '@/lib/auth/actions';
import { cn } from '@/lib/utils';
import { AwsIcon } from './aws-icon';
import { BrandLink } from './brand-link';
import { NAV_ITEMS, type NavItem } from './nav-items';

/** The label names the item, so its icon is decorative. */
function NavIcon({ icon: Icon }: { icon: NavItem['icon'] }) {
  if (typeof Icon === 'string') return <AwsIcon name={Icon} size={16} alt="" eager />;
  return <Icon className="size-4 shrink-0" aria-hidden />;
}

export function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('Common.nav');
  const pathname = usePathname();

  return (
    <ul className="space-y-1">
      {NAV_ITEMS.map(({ key, href, icon, enabled }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const classes = cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
          active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground',
          enabled
            ? 'hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring'
            : 'cursor-not-allowed',
        );
        return (
          <li key={key}>
            {enabled ? (
              <Link href={href} className={classes} aria-current={active ? 'page' : undefined} onClick={onNavigate}>
                <NavIcon icon={icon} />
                {t(key)}
              </Link>
            ) : (
              <span className={classes} aria-disabled="true">
                {/* Disabled: the label and badge are dimmed, the AWS icon is shown as published. */}
                <NavIcon icon={icon} />
                <span className="min-w-0 truncate opacity-70">{t(key)}</span>
                <span className="ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[11px] leading-none whitespace-nowrap opacity-70">
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

export function SignOutForm() {
  const t = useTranslations('Common.nav');
  const locale = useLocale();
  return (
    <form action={signOutAction.bind(null, locale)}>
      <button
        type="submit"
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <LogOut className="size-4" aria-hidden />
        {t('signOut')}
      </button>
    </form>
  );
}

export function Sidebar({ signedIn }: { signedIn: boolean }) {
  const t = useTranslations('Common.nav');

  return (
    <aside className="hidden w-72 shrink-0 border-r bg-sidebar md:block">
      {/* The panel stays in view while a long page scrolls; the aside keeps the background full height. */}
      <div className="sticky top-0 flex h-screen flex-col px-4 py-5">
        <BrandLink className="mb-8 px-2 text-lg" />
        <nav aria-label={t('mainNavigation')} className="flex-1">
          <NavList />
        </nav>
        {signedIn && <SignOutForm />}
      </div>
    </aside>
  );
}
