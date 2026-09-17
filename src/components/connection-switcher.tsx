'use client';

import { ChevronsUpDown, Cloud } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Link, usePathname } from '@/i18n/navigation';
import { isUsableStatus } from '@/lib/connections/types';
import type { ConnectionRow } from '@/lib/db/schema';
import { parseMonitoringPath, switchConnectionPath } from '@/lib/monitoring/shared/paths';

export type ShellConnection = Pick<ConnectionRow, 'id' | 'name' | 'regions' | 'status'>;

export function ConnectionSwitcher({ connections }: { connections: ShellConnection[] }) {
  const t = useTranslations('Shell');
  const params = useParams<{ id?: string }>();
  const pathname = usePathname();
  const selection = parseMonitoringPath(pathname);
  const current = connections.find((c) => c.id === (selection?.connectionId ?? params.id)) ?? connections[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="min-w-0 max-w-64 shrink justify-between gap-2" aria-label={t('account')}>
          <Cloud className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{current ? current.name : t('noAccounts')}</span>
          {current && <span className="hidden text-xs text-muted-foreground sm:inline">{selection?.region ?? current.regions[0]}</span>}
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t('account')}</DropdownMenuLabel>
        {connections.map((c) => {
          const usable = isUsableStatus(c.status);
          const href = usable ? switchConnectionPath(pathname, { connectionId: c.id, region: c.regions[0] }) : `/accounts/${c.id}`;
          return (
            <DropdownMenuItem key={c.id} asChild>
              <Link href={href} className="flex flex-col items-start">
                <span>{c.name}</span>
                <span className="text-xs text-muted-foreground">
                  {usable ? `${t('region')}: ${c.regions.join(', ')}` : t('notMonitorable')}
                </span>
              </Link>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/accounts">{t('manageAccounts')}</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
