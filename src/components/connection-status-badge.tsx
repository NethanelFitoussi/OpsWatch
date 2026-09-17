import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import type { ConnectionStatus } from '@/lib/connections/types';
import { cn } from '@/lib/utils';

const STYLES: Record<ConnectionStatus, string> = {
  draft: 'border-transparent bg-muted text-muted-foreground',
  pending: 'border-transparent bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
  ok: 'border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  degraded: 'border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  failed: 'border-transparent bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
};

export function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  const t = useTranslations('Status');
  return <Badge className={cn(STYLES[status])}>{t(status)}</Badge>;
}
