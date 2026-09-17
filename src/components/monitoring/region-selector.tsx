'use client';

import { Check, MapPin } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Link, usePathname } from '@/i18n/navigation';
import { withRegion } from '@/lib/monitoring/shared/paths';

export function RegionSelector({ regions, current }: { regions: string[]; current: string }) {
  const t = useTranslations('Monitoring.client');
  const pathname = usePathname();
  // The whole query string follows the switch, like the time range selector: filters, searches and the range.
  const search = useSearchParams().toString();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label={t('region.label')}>
          <MapPin className="size-4" aria-hidden />
          {t('region.current', { region: current })}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {regions.map((region) => (
          <DropdownMenuItem key={region} asChild>
            <Link
              href={withRegion(pathname, region, search)}
              aria-current={region === current ? 'true' : undefined}
              className="flex items-center justify-between gap-4"
            >
              {region}
              {region === current && <Check className="size-4" aria-hidden />}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
