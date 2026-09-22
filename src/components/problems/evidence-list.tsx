import { getTranslations } from 'next-intl/server';
import type { Evidence } from '@opswatch/contract';

/**
 * The evidence bundle: what the detector actually read.
 *
 * Every item in phase 1 is an observed fact, and the heading says so. When correlations and hypotheses
 * arrive they must be visibly separated here — presenting an inference as a measurement is the one thing
 * this product must never do.
 */
export async function EvidenceList({ evidence }: { evidence: readonly Evidence[] }) {
  const t = await getTranslations('Monitoring.problems.detail');

  if (evidence.length === 0) return <p className="text-sm text-muted-foreground">{t('noEvidence')}</p>;

  return (
    <ul aria-label={t('evidence')} className="divide-y">
      {evidence.map((item) => (
        <li key={item.id} className="flex items-baseline justify-between gap-4 py-2 text-sm">
          <span className="min-w-0">{item.title}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {/* A measurement that was not taken says so; it is never rendered as 0 (§2.4). */}
            {item.detail ?? t('notMeasured')}
          </span>
        </li>
      ))}
    </ul>
  );
}
