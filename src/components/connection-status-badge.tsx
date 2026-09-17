import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import type { ConnectionStatus } from '@/lib/connections/types';
import { TONE_SOFT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

const STYLES: Record<ConnectionStatus, string> = {
  draft: 'border-transparent bg-muted text-muted-foreground',
  pending: cn('border-transparent', TONE_SOFT.info),
  ok: cn('border-transparent', TONE_SOFT.success),
  degraded: cn('border-transparent', TONE_SOFT.warning),
  failed: cn('border-transparent', TONE_SOFT.danger),
};

export function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  const t = useTranslations('Status');
  return <Badge className={cn(STYLES[status])}>{t(status)}</Badge>;
}
