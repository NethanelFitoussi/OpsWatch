import { getTranslations } from 'next-intl/server';
import { SectionCard } from '@/components/section-card';
import type { Provider } from '@/lib/connections/types';
import { MONITORING_CAPABILITIES, capabilitiesOf } from '@/lib/monitoring/capabilities';
import { TONE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

/**
 * What OpsWatch can read from this cloud, and what it cannot.
 *
 * On every connection, whatever the provider — including AWS, where it is a list of ticks. A table
 * that only appeared for the incomplete providers would read as an apology, and the same question is
 * worth answering for the complete one: an operator deciding where to put a workload, or why a page
 * is missing, is asking the same thing either way.
 *
 * The two kinds of "no" are shown as different things because they lead to different actions.
 * "DigitalOcean does not offer this" ends the matter. "OpsWatch has not built it" does not, and an
 * operator who reads the first when the second is true goes looking for another product.
 */
export async function CapabilityTable({ provider }: { provider: Provider }) {
  const t = await getTranslations('Capabilities');
  const declared = capabilitiesOf(provider);

  return (
    <SectionCard title={t('title')} description={t('hint')}>
      <dl className="grid gap-3 sm:grid-cols-2">
        {MONITORING_CAPABILITIES.map((capability) => {
          const support = declared[capability];
          return (
            <div key={capability} className="min-w-0 rounded-lg border p-3">
              <dt className="text-xs text-muted-foreground">{t(`names.${capability}`)}</dt>
              <dd
                className={cn(
                  'mt-0.5 text-sm font-medium',
                  support.state === 'supported' ? TONE_TEXT.success : 'text-muted-foreground',
                )}
              >
                {t(`states.${support.state}`)}
                {/* How the data reaches OpsWatch, said only where there is a choice to understand:
                    direct is the default and never requires forwarding anything anywhere. */}
                {support.state === 'supported' && support.modes.includes('managed') && (
                  <span className="block text-xs font-normal text-muted-foreground">{t('alsoManaged')}</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="mt-3 text-sm text-muted-foreground">{t('direct')}</p>
    </SectionCard>
  );
}
