import { getFormatter, getTranslations } from 'next-intl/server';
import { SectionCard } from '@/components/section-card';
import { Link } from '@/i18n/navigation';
import { DO_SCOPE } from '@/lib/do/check';
import type { ConnectionRow } from '@/lib/db/schema';
import { TONE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';
import { VerifyDoForm } from '../forms';
import { verifyDoAction } from '../../actions';

/**
 * A connected DigitalOcean account.
 *
 * Short, because there is little to say: one token, one scope, one thing it can read. What it does say
 * is what the token is allowed to do and what OpsWatch never asked for — the page an operator reads
 * when deciding whether to keep the connection is this one, not the wizard they have forgotten.
 */
export async function DoSetup({ row, locale }: { row: ConnectionRow; locale: string }) {
  const t = await getTranslations('DoSetup');
  const format = await getFormatter();
  const result = row.doLastTest;

  return (
    <>
      <SectionCard title={t('accessTitle')} description={t('accessHint')}>
        <p className="text-sm">
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{DO_SCOPE}</code> — {t('scope')}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">{t('stored')}</p>
      </SectionCard>

      <SectionCard title={t('verifyTitle')} description={t('verifyHint')} contentClassName="space-y-3">
        <VerifyDoForm action={verifyDoAction.bind(null, locale, row.id)} />

        {result === null || result === undefined ? (
          // Never tested is its own state, and it is not a failure.
          <p className="text-sm text-muted-foreground">{t('neverTested')}</p>
        ) : (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{t('testedAt', { when: format.relativeTime(new Date(result.testedAt)) })}</p>
            {result.failure === null ? (
              <>
                <p className={cn('text-sm font-medium', TONE_TEXT.success)}>{t('ok', { count: result.droplets ?? 0 })}</p>
                <p className="text-sm">
                  <Link href={`/accounts/${row.id}/droplets`} className="text-primary underline-offset-4 hover:underline">
                    {t('droplets')}
                  </Link>
                </p>
              </>
            ) : (
              <p className={cn('text-sm font-medium', TONE_TEXT.danger)}>{t(`failures.${result.failure}`)}</p>
            )}
          </div>
        )}
      </SectionCard>
    </>
  );
}
