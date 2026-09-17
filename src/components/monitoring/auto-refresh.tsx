'use client';

import { Pause, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import { AUTO_REFRESH_MS, mountRefreshTimer, type RefreshTimer } from '@/lib/monitoring/shared/refresh-timer';

/** Re-renders the page's server components every two minutes while the tab is visible, unless paused. */
export function AutoRefresh() {
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
    const mounted = mountRefreshTimer({
      onTick: () => routerRef.current.refresh(),
      isPaused: () => pausedRef.current,
      target: document,
    });
    timer.current = mounted.timer;
    return () => {
      mounted.dispose();
      timer.current = null;
    };
  }, []);

  useEffect(() => {
    pausedRef.current = paused;
    timer.current?.setPaused(paused);
  }, [paused]);

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
        {paused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
        {paused ? t('refresh.resume') : t('refresh.pause')}
      </Button>
      <span className="text-xs text-muted-foreground" aria-live="polite">
        {paused ? t('refresh.paused') : t('refresh.every', { minutes: AUTO_REFRESH_MS / 60_000 })}
      </span>
    </div>
  );
}
