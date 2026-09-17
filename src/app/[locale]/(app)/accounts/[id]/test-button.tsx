'use client';

import { Loader2, PlayCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';

export function TestButton({ connectionId }: { connectionId: string }) {
  const t = useTranslations('Checklist');
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  async function run() {
    setRunning(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/connections/${connectionId}/test`, { method: 'POST' });
      if (res.status === 401) {
        // The session expired: sign in again rather than showing a generic error.
        router.push('/login');
        return;
      }
      if (!res.ok) {
        setFailed(true);
      }
      startTransition(() => router.refresh());
    } catch {
      setFailed(true);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button type="button" onClick={run} disabled={running}>
        {running ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <PlayCircle className="size-4" aria-hidden />}
        {running ? t('running') : t('run')}
      </Button>
      {failed && <p role="alert" className="text-sm text-red-600">{t('failedRequest')}</p>}
    </div>
  );
}
