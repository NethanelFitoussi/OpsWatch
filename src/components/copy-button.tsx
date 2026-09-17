'use client';

import { Check, Copy, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { copyText } from '@/lib/clipboard';

type CopyStatus = 'idle' | 'copied' | 'failed';

const ICONS = { idle: Copy, copied: Check, failed: X } as const;
const LABELS = { idle: 'copy', copied: 'copied', failed: 'copyFailed' } as const;

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const t = useTranslations('Common.actions');
  const [status, setStatus] = useState<CopyStatus>('idle');

  useEffect(() => {
    if (status === 'idle') return;
    const timer = setTimeout(() => setStatus('idle'), 2000);
    return () => clearTimeout(timer);
  }, [status]);

  async function copy() {
    setStatus((await copyText(value)) ? 'copied' : 'failed');
  }

  const Icon = ICONS[status];
  return (
    <Button type="button" variant="outline" size="sm" onClick={copy} aria-label={label ?? t('copy')}>
      <Icon className="size-4" aria-hidden />
      <span aria-live="polite">{t(LABELS[status])}</span>
    </Button>
  );
}
