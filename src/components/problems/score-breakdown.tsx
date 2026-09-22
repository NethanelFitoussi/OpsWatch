import { getTranslations } from 'next-intl/server';
import type { StoredScoreTerms } from '@/lib/db/schema';

const TERMS = ['s', 'b', 't', 'u', 'd'] as const;
type Term = (typeof TERMS)[number];

/**
 * "Why this score" — the arithmetic the engine actually used, rendered rather than restated.
 *
 * §4.3 asks for the score to be argued with, which means showing the five terms, their weights and what each
 * contributed. The numbers come from the row the detector wrote, so the page cannot disagree with the engine.
 *
 * A term that could not be measured shows as *not known yet*, not as zero. That is §33.7's whole point: a
 * subject with no dependency edge, first seen minutes ago, is judged on what could be measured and the score
 * is rescaled over the weight actually available.
 */
export async function ScoreBreakdown({ terms }: { terms: StoredScoreTerms }) {
  const t = await getTranslations('Monitoring.problems.detail');

  return (
    <details className="rounded-md border">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{t('why')}</summary>
      <div className="border-t px-4 py-3">
        <p className="text-sm text-muted-foreground">{t('whyDescription', { score: terms.score })}</p>
        <table className="mt-3 w-full text-sm">
          <caption className="sr-only">{t('why')}</caption>
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th scope="col" className="py-1 pr-4 font-medium">
                <span className="sr-only">{t('why')}</span>
              </th>
              <th scope="col" className="py-1 pr-4 font-medium">{t('value')}</th>
              <th scope="col" className="py-1 pr-4 font-medium">{t('weight')}</th>
              <th scope="col" className="py-1 font-medium">{t('contribution')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {TERMS.map((term: Term) => {
              const value = terms[term];
              const weight = terms.weights[term];
              return (
                <tr key={term}>
                  <th scope="row" className="py-1.5 pr-4 text-left font-normal">{t(`term.${term}`)}</th>
                  <td className="py-1.5 pr-4 tabular-nums">
                    {value === null ? <span className="text-muted-foreground">{t('unavailable')}</span> : value.toFixed(2)}
                  </td>
                  <td className="py-1.5 pr-4 tabular-nums text-muted-foreground">{weight}</td>
                  <td className="py-1.5 tabular-nums">{value === null ? '—' : (value * weight).toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {terms.rescaled && (
          <p className="mt-3 text-sm text-muted-foreground">
            {t('rescaled', { available: terms.availableWeight })} {t('unavailableHint')}
          </p>
        )}
        {terms.floored && <p className="mt-2 text-sm">{t('floored')}</p>}
      </div>
    </details>
  );
}
