import { getFormatter, getTranslations } from 'next-intl/server';
import type { Evidence } from '@opswatch/contract';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';

/**
 * §7's three bands, rendered so a reader can tell them apart without effort.
 *
 * They are separate headed groups rather than one interleaved list with badges. An operator scanning a
 * timeline under pressure reads position before they read labels, so a hypothesis sitting between two facts
 * would be read as a third fact however it were tagged. The separation is the feature.
 */
export async function InvestigationTimeline({
  timeline,
  notEvaluated,
  locale,
}: {
  timeline: Evidence[];
  notEvaluated: readonly string[];
  locale: string;
}) {
  const t = await getTranslations({ locale, namespace: 'Monitoring.investigation' });
  const format = await getFormatter({ locale });
  // The band promises "with the time it recorded them", and without this it kept none of that promise:
  // two facts of the same kind rendered as two identical lines with nothing to tell them apart.
  const when = (at: number) => format.dateTime(new Date(at), { dateStyle: 'medium', timeStyle: 'short' });
  const facts = timeline.filter((item) => item.kind === 'fact');
  const correlations = timeline.filter((item) => item.kind === 'correlation');
  const hypotheses = timeline.filter((item) => item.kind === 'hypothesis');

  if (timeline.length === 0) {
    return (
      <MonitoringCard title={t('title')}>
        {/* Nothing happened near this problem that OpsWatch recorded — which is not the same as nothing
            having happened, and the sentence says so. */}
        <p className="text-sm">{t('nothingRecorded')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('nothingRecordedHint')}</p>
      </MonitoringCard>
    );
  }

  return (
    <MonitoringCard title={t('title')} description={t('description')}>
      <section aria-labelledby="band-facts">
        <h3 id="band-facts" className="text-sm font-medium">{t('facts')}</h3>
        <p className="text-xs text-muted-foreground">{t('factsHint')}</p>
        {facts.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">{t('noFacts')}</p>
        ) : (
          <ul className="mt-1 divide-y">
            {facts.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm">
                <span className="min-w-0">{item.title}</span>
                <time dateTime={new Date(item.at).toISOString()} className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {when(item.at)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="band-correlations" className="mt-4">
        <h3 id="band-correlations" className="text-sm font-medium">{t('correlations')}</h3>
        {/* The sentence that keeps this honest, on the band rather than on each row. */}
        <p className="text-xs text-muted-foreground">{t('correlationsHint')}</p>
        {correlations.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">{t('noCorrelations')}</p>
        ) : (
          <ul className="mt-1 divide-y">
            {correlations.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm">
                <span className="min-w-0">{item.title}</span>
                <time dateTime={new Date(item.at).toISOString()} className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {when(item.at)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="band-hypotheses" className="mt-4">
        <h3 id="band-hypotheses" className="text-sm font-medium">{t('hypotheses')}</h3>
        <p className="text-xs text-muted-foreground">{t('hypothesesHint')}</p>
        {hypotheses.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">{t('noHypotheses')}</p>
        ) : (
          <ul className="mt-1 divide-y">
            {hypotheses.map((item) => (
              <li key={item.id} className="py-2 text-sm">
                <span className="flex flex-wrap items-baseline gap-2">
                  <span>{item.title}</span>
                  {item.confidence !== undefined && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tracking-wide uppercase">
                      {t(`confidence.${item.confidence}`)}
                    </span>
                  )}
                </span>
                {item.detail !== undefined && <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>}
              </li>
            ))}
          </ul>
        )}
        {notEvaluated.length > 0 && (
          // §2.6 again: the catalogue was not fully run, and saying so is what makes the rest a measurement.
          <p className="mt-2 text-xs text-muted-foreground">{t('notEvaluated', { count: notEvaluated.length })}</p>
        )}
      </section>
    </MonitoringCard>
  );
}
