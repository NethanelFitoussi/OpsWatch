import { Info, OctagonAlert, TriangleAlert } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { formatInsightValues, type Insight, type InsightSeverity } from '@/lib/monitoring/insights';
import { expandValues } from '@/lib/read/message-values';
import { TONE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

const ICON: Record<InsightSeverity, typeof Info> = { critical: OctagonAlert, warning: TriangleAlert, info: Info };
const ICON_CLASS: Record<InsightSeverity, string> = { critical: TONE_TEXT.danger, warning: TONE_TEXT.warning, info: 'text-muted-foreground' };
const LINK_CLASS = 'shrink-0 text-sm font-medium text-primary underline-offset-4 hover:underline';

/** The insights of the Overview, worst first; a grouped insight lists its members in a disclosure. */
export async function InsightList({ insights }: { insights: readonly Insight[] }) {
  const t = await getTranslations('Insights');
  const tList = await getTranslations('Monitoring.overview.insights');
  const root = await getTranslations();
  const locale = await getLocale();

  /**
   * A detector stores ids where the sentence needs words, because a job has no locale of its own. They
   * become words here. `has` rather than a try: next-intl answers a missing message with its own key
   * path, so catching nothing would have printed `Monitoring.alarms.kinds.…` into the sentence.
   */
  const values = (key: string, stored: Insight['values']) =>
    formatInsightValues(key, expandValues(stored, (one) => (root.has(one) ? root(one) : null)), locale);

  return (
    <ul aria-label={tList('listLabel')} className="divide-y">
      {insights.map((insight) => {
        const Icon = ICON[insight.severity];
        return (
          <li key={`${insight.kind}/${insight.resource}`} className="flex items-start gap-3 py-3">
            <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', ICON_CLASS[insight.severity])} />
            <div className="min-w-0 flex-1 text-sm">
              <p>
                <span className="sr-only">{t(`severity.${insight.severity}`)}: </span>
                {t(insight.messageKey, values(insight.messageKey, insight.values))}
              </p>
              {insight.members && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-sm text-muted-foreground">{tList('showMembers', { count: insight.members.length })}</summary>
                  <ul className="mt-2 space-y-1 text-sm">
                    {insight.members.map((member) => (
                      <li key={member.resource}>
                        <Link href={member.href} className="text-primary underline-offset-4 hover:underline">
                          {t(member.messageKey, values(member.messageKey, member.values))}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
            <Link href={insight.href} className={LINK_CLASS}>
              {tList('view')}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
