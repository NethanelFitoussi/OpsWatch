import { Info, OctagonAlert, TriangleAlert } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { formatInsightValues, type Insight, type InsightSeverity } from '@/lib/monitoring/insights';
import { TONE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

const ICON: Record<InsightSeverity, typeof Info> = { critical: OctagonAlert, warning: TriangleAlert, info: Info };
const ICON_CLASS: Record<InsightSeverity, string> = { critical: TONE_TEXT.danger, warning: TONE_TEXT.warning, info: 'text-muted-foreground' };
const LINK_CLASS = 'shrink-0 text-sm font-medium text-primary underline-offset-4 hover:underline';

/** The insights of the Overview, worst first; a grouped insight lists its members in a disclosure. */
export async function InsightList({ insights }: { insights: readonly Insight[] }) {
  const t = await getTranslations('Insights');
  const tList = await getTranslations('Monitoring.overview.insights');
  const locale = await getLocale();

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
                {t(insight.messageKey, formatInsightValues(insight.messageKey, insight.values, locale))}
              </p>
              {insight.members && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-sm text-muted-foreground">{tList('showMembers', { count: insight.members.length })}</summary>
                  <ul className="mt-2 space-y-1 text-sm">
                    {insight.members.map((member) => (
                      <li key={member.resource}>
                        <Link href={member.href} className="text-primary underline-offset-4 hover:underline">
                          {t(member.messageKey, formatInsightValues(member.messageKey, member.values, locale))}
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
