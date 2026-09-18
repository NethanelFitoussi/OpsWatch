import { getTranslations } from 'next-intl/server';
import type { Coverage } from '@/lib/analysis/coverage';
import { TONE_TEXT } from '@/lib/ui/tones';

type ResourceKey = 'services' | 'instances' | 'loadBalancers' | 'logGroups' | 'alarms';

/** One line under a page header: how much of the resource set the query budget let the page cover. */
export async function CoverageNote({ coverage, resourceKey }: { coverage: Coverage; resourceKey: ResourceKey }) {
  if (coverage.total === 0) return null;
  const t = await getTranslations('Monitoring.common');
  return (
    <p className="text-sm text-muted-foreground">
      {t('coverage.covered', { covered: coverage.covered, total: coverage.total, resource: t(`coverage.resource.${resourceKey}`) })}
      {coverage.truncated && <> <span className={TONE_TEXT.warning}>{t('coverage.truncated', { covered: coverage.covered })}</span></>}
    </p>
  );
}
