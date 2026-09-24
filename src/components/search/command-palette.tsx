'use client';

import { Search as SearchIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * Finding anything, from anywhere, without reaching for the mouse.
 *
 * Opened with `/` or `Ctrl`/`Cmd`-K and closed with `Escape`; the arrow keys move the selection and
 * `Enter` follows it. A monitoring tool is used at speed and often at three in the morning, and a search
 * that needs a mouse is one nobody uses twice.
 *
 * It is a combobox over a listbox, not a menu of links: the input keeps focus while the arrows move
 * `aria-activedescendant`, which is what lets a screen-reader user hear each result as they move through
 * it without losing the text they are typing.
 */

type Result = { kind: string; id: string; title: string; context: string; state?: string; href: string };

/** Long enough not to fire on a stray keystroke, short enough that typing feels answered. */
const DEBOUNCE_MS = 150;

export function CommandPalette({ environment }: { environment: string | null }) {
  const t = useTranslations('Search');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setResults([]);
    setActive(0);
  }, []);

  // `/` opens it the way every text-first tool does; Ctrl-K the way every command palette does. Neither
  // fires while somebody is typing into a field, which would make every form in the product unusable.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen(true);
      } else if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  // An empty query has no results by definition, so it is derived rather than stored: clearing state
  // from inside an effect is how a list from the previous query survives one render too long.
  const shown = query.trim().length === 0 ? [] : results;

  useEffect(() => {
    if (!open || environment === null || query.trim().length === 0) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      void fetch(`/api/v1/search?env=${encodeURIComponent(environment)}&q=${encodeURIComponent(query)}`, { signal: controller.signal })
        // The v1 envelope *is* the body; there is no `data` wrapper. Reading one returned undefined and
        // the palette silently showed nothing for every query.
        .then((response) => response.json() as Promise<{ items?: Result[] }>)
        .then((body) => {
          setResults(body.items ?? []);
          setActive(0);
        })
        .catch(() => {
          // An aborted or failed search shows nothing rather than a stale list from the previous query.
          setResults([]);
        })
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, query, environment]);

  const go = useCallback(
    (result: Result | undefined) => {
      if (result === undefined) return;
      close();
      router.push(result.href);
    },
    [close, router],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => (results.length === 0 ? 0 : (current + 1) % results.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => (results.length === 0 ? 0 : (current - 1 + results.length) % results.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(results[active]);
    }
  };

  if (environment === null) return null;

  return (
    <>
      {/* Named distinctly from the "Search" submit button every section's filter row already has: two
          controls with the same accessible name on one page is a genuine problem for anybody listing them. */}
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-2" aria-haspopup="dialog" aria-label={t('title')}>
        <SearchIcon className="size-4" aria-hidden />
        <span className="hidden sm:inline">{t('open')}</span>
        {/* The shortcut is on the button, because a shortcut nobody is told about is one nobody uses. */}
        <kbd className="hidden rounded border px-1 font-mono text-[10px] text-muted-foreground lg:inline">/</kbd>
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]" onClick={close}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('title')}
            className="w-full max-w-xl overflow-hidden rounded-xl border bg-background shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b px-3">
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <input
                ref={input}
                type="search"
                role="combobox"
                aria-expanded={shown.length > 0}
                aria-controls={listId}
                aria-activedescendant={shown.length > 0 ? `${listId}-${active}` : undefined}
                aria-label={t('title')}
                autoComplete="off"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder={t('placeholder')}
                className="h-12 w-full bg-transparent text-sm outline-none"
              />
            </div>

            <ul id={listId} role="listbox" aria-label={t('results')} className="max-h-[50vh] overflow-y-auto">
              {shown.map((result, index) => (
                <li
                  key={`${result.kind}:${result.id}`}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => go(result)}
                  className={cn('cursor-pointer px-3 py-2', index === active && 'bg-accent')}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium">{result.title}</span>
                    {/* A state already measured elsewhere. Its absence means the thing has none. */}
                    {result.state !== undefined && <span className="shrink-0 text-xs text-muted-foreground">{result.state}</span>}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{result.context}</p>
                </li>
              ))}
            </ul>

            {query.trim().length > 0 && shown.length === 0 && !loading && (
              <p className="px-3 py-4 text-sm text-muted-foreground">{t('noResults')}</p>
            )}
            <p className="border-t px-3 py-2 text-xs text-muted-foreground">{t('hint')}</p>
          </div>
        </div>
      )}
    </>
  );
}
