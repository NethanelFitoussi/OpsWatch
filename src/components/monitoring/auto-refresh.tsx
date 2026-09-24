'use client';

import { Pause, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import { mountRefreshTimer, type RefreshTimer } from '@/lib/monitoring/shared/refresh-timer';

/**
 * Re-renders the page's server components at the interval chosen in Settings, while the tab is visible
 * and not paused. An interval of 0 is "off": no timer is mounted, and the control says so instead of
 * offering a pause for something that never runs.
 */
export function AutoRefresh({ intervalMs }: { intervalMs: number }) {
  const t = useTranslations('Monitoring.client');
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const timer = useRef<RefreshTimer | null>(null);
  // Refs rather than dependencies: a re-run of the mount effect below would otherwise resume a paused
  // page while the button still says paused, and restart the interval on every router identity change.
  const pausedRef = useRef(paused);
  const routerRef = useRef(router);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    if (intervalMs <= 0) return;
    const mounted = mountRefreshTimer({
      onTick: () => routerRef.current.refresh(),
      isPaused: () => pausedRef.current,
      target: document,
      intervalMs,
    });
    timer.current = mounted.timer;
    return () => {
      mounted.dispose();
      timer.current = null;
    };
  }, [intervalMs]);

  useEffect(() => {
    pausedRef.current = paused;
    timer.current?.setPaused(paused);
  }, [paused]);

  if (intervalMs <= 0) {
    return (
      <span className="text-xs text-muted-foreground" aria-live="polite">
        {t('refresh.off')}
      </span>
    );
  }

  // Whole minutes read as minutes; anything shorter (30 s) reads as seconds.
  const cadence =
    intervalMs % 60_000 === 0 ? t('refresh.every', { minutes: intervalMs / 60_000 }) : t('refresh.everySeconds', { seconds: intervalMs / 1000 });

  return (
    // Wrapping rather than overflowing: the label is longer in some locales than the whole header is
    // wide at 360px, and a button that runs off its card is worse than one on its own line.
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
        {paused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
        {paused ? t('refresh.resume') : t('refresh.pause')}
      </Button>
      <span className="text-xs text-muted-foreground" aria-live="polite">
        {paused ? t('refresh.paused') : cadence}
      </span>
    </div>
  );
}
