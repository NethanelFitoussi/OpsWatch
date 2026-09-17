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
import { Link } from '@/i18n/navigation';
import type { ConnectionRow } from '@/lib/db/schema';

export type ShellConnection = Pick<ConnectionRow, 'id' | 'name' | 'regions'>;

export function ConnectionSwitcher({ connections }: { connections: ShellConnection[] }) {
  const t = useTranslations('Shell');
  const params = useParams<{ id?: string }>();
  const current = connections.find((c) => c.id === params.id) ?? connections[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="min-w-0 max-w-64 shrink justify-between gap-2" aria-label={t('account')}>
          <Cloud className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{current ? current.name : t('noAccounts')}</span>
          {current && <span className="hidden text-xs text-muted-foreground sm:inline">{current.regions[0]}</span>}
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t('account')}</DropdownMenuLabel>
        {connections.map((c) => (
          <DropdownMenuItem key={c.id} asChild>
            <Link href={`/accounts/${c.id}`} className="flex flex-col items-start">
              <span>{c.name}</span>
              <span className="text-xs text-muted-foreground">
                {t('region')}: {c.regions.join(', ')}
              </span>
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/accounts">{t('manageAccounts')}</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
