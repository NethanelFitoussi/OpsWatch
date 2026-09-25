'use client';

import { Check, ChevronsUpDown, Cloud } from 'lucide-react';
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
import { cn } from '@/lib/utils';

/**
 * Which AWS account and region the page is about, and the way to another one.
 *
 * Two rules it did not used to follow, and both of them matter once there is more than one account:
 *
 *   - **It never claims an account the page is not about.** On Settings, the documentation or Cloudflare
 *     there is no selection at all, and the chip used to fall back to `connections[0]` — so the top bar
 *     read "Production" above a page that belonged to the whole installation. It now says so.
 *   - **A region is a destination, not a caption.** The regions of each connection used to be printed as
 *     inert text while every entry navigated to `regions[0]`, so a connection watched in three regions
 *     could only be entered through one of them. Each region is its own entry.
 */

export type ShellConnection = Pick<ConnectionRow, 'id' | 'name' | 'provider' | 'regions' | 'status'>;

export function ConnectionSwitcher({ connections }: { connections: ShellConnection[] }) {
  const t = useTranslations('Shell');
  const params = useParams<{ id?: string }>();
  const pathname = usePathname();
  const selection = parseMonitoringPath(pathname);
  // Only what the page is genuinely about: the monitoring path's connection, or an account page's own.
  const current = connections.find((c) => c.id === (selection?.connectionId ?? params.id)) ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="min-w-0 max-w-64 shrink justify-between gap-2" aria-label={t('account')}>
          <Cloud className="size-4 shrink-0" aria-hidden />
          <span className={cn('min-w-0 truncate', current === null && 'text-muted-foreground')}>
            {connections.length === 0 ? t('noAccounts') : (current?.name ?? t('noSelection'))}
          </span>
          {current !== null && selection !== null && (
            <span className="hidden text-xs text-muted-foreground sm:inline">{selection.region}</span>
          )}
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>{t('account')}</DropdownMenuLabel>
        {connections.map((c) => {
          /*
            * A region is a destination only where the sections behind it exist. Every one of them is a
            * page about an AWS service, so a Google or DigitalOcean connection offering `eu-west-1`
            * here would be offering a page that then asks AWS about an account that is not there.
            * It links to its own connection page, which is where what it can show actually lives.
            */
          const usable = c.provider === 'aws' && isUsableStatus(c.status);
          return (
            <div key={c.id}>
              <DropdownMenuLabel className="pb-0 text-xs font-medium text-muted-foreground">{c.name}</DropdownMenuLabel>
              {usable ? (
                // One entry per region: a connection watched in three regions has three destinations.
                c.regions.map((region) => {
                  const here = current?.id === c.id && selection?.region === region;
                  return (
                    <DropdownMenuItem key={region} asChild>
                      <Link href={switchConnectionPath(pathname, { connectionId: c.id, region })} className="flex items-center justify-between gap-2">
                        <span>{region}</span>
                        {here && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
                      </Link>
                    </DropdownMenuItem>
                  );
                })
              ) : (
                <DropdownMenuItem asChild>
                  <Link href={`/accounts/${c.id}`} className="text-muted-foreground">
                    {c.provider === 'aws' ? t('notMonitorable') : t('openConnection')}
                  </Link>
                </DropdownMenuItem>
              )}
            </div>
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
