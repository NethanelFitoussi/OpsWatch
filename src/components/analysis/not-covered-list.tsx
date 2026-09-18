import { getTranslations } from 'next-intl/server';
import type { NotCovered } from '@/lib/analysis/coverage';

/** The resources a capped page or the audit left out, with the reason and, for an AWS failure, its error code. */
export async function NotCoveredList({ rows, titleKey }: { rows: readonly NotCovered[]; titleKey: string }) {
  if (rows.length === 0) return null;
  const t = await getTranslations();
  const tCommon = await getTranslations('Monitoring.common.notCovered');
  return (
    <section>
      <h3 className="text-sm font-medium">{t(titleKey)}</h3>
      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
        {rows.map((row, index) => (
          <li key={`${row.resource}-${index}`}>
            <span className="font-medium text-foreground">{row.resource}</span>
            {' — '}
            {tCommon(row.reason)}
            {row.code !== null && <> {tCommon('code', { code: row.code, action: row.action ?? '' })}</>}
          </li>
        ))}
      </ul>
    </section>
  );
}
