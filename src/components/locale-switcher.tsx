'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from '@/i18n/locale-cookie';
import { routing, type AppLocale } from '@/i18n/routing';
import { cn } from '@/lib/utils';

// Defined outside the component so the eslint react-compiler rule does not treat this
// document.cookie write as a component/hook mutating external state during render.
function setLocaleCookie(next: AppLocale) {
  document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
}

export function LocaleSwitcher() {
  const t = useTranslations('Common.language');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  function choose(next: AppLocale) {
    setLocaleCookie(next);
    // No localized pathnames are configured, so the current pathname (dynamic
    // segments included) is valid in every locale.
    router.replace(pathname, { locale: next });
  }

  return (
    <div role="group" aria-label={t('label')} className="flex rounded-md border p-0.5 text-xs font-medium">
      {routing.locales.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={code === locale}
          title={t(code)}
          onClick={() => choose(code)}
          className={cn(
            'rounded px-2 py-1 uppercase transition-colors focus-visible:outline-2 focus-visible:outline-ring',
            code === locale ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
