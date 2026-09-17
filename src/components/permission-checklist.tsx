import { CircleCheck, CircleMinus, CircleX, TriangleAlert } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';
import { knownIdentityError } from '@/lib/aws/identity-errors';
import type { CheckStatus, PermissionTestResult } from '@/lib/connections/types';
import { TONE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

const ICONS: Record<CheckStatus, { icon: typeof CircleCheck; className: string }> = {
  ok: { icon: CircleCheck, className: TONE_TEXT.success },
  denied: { icon: TriangleAlert, className: TONE_TEXT.warning },
  error: { icon: CircleX, className: TONE_TEXT.danger },
  not_applicable: { icon: CircleMinus, className: 'text-muted-foreground' },
};

export async function PermissionChecklist({ result, account }: { result: PermissionTestResult | null; account: string }) {
  const t = await getTranslations('Checklist');
  const services = await getTranslations('Services');
  const format = await getFormatter();

  if (!result) {
    return <p className="text-sm text-muted-foreground">{t('neverRun')}</p>;
  }

  if (result.identityError) {
    const code = result.identityError;
    const known = knownIdentityError(code);
    return (
      <div role="status" className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        {known ? t(`identityErrors.${known}`, { account, code }) : t('identityErrors.generic', { code })}
      </div>
    );
  }

  const regions = [...new Set(result.checks.map((c) => c.region))];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t('testedAt', { date: format.relativeTime(new Date(result.testedAt)) })}
        {result.identityArn && <> · {t('identity', { arn: result.identityArn })}</>}
      </p>
      {regions.map((region) => (
        <section key={region} aria-labelledby={`region-${region}`}>
          <h3 id={`region-${region}`} className="mb-2 font-mono text-xs uppercase text-muted-foreground">{region}</h3>
          <ul className="divide-y rounded-md border">
            {result.checks
              .filter((c) => c.region === region)
              .map((check) => {
                const { icon: Icon, className } = ICONS[check.status];
                return (
                  <li key={check.service} className="flex items-start gap-3 p-3">
                    <Icon className={cn('mt-0.5 size-5 shrink-0', className)} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {services(check.service)}{' '}
                        <span className="text-sm font-normal text-muted-foreground">· {t(`statuses.${check.status}`)}</span>
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">{check.action}</p>
                      {check.status === 'denied' && (
                        <p className="mt-1 text-sm">{t('denied', { action: check.action, impact: t(`impact.${check.service}`) })}</p>
                      )}
                      {check.status === 'error' && <p className="mt-1 text-sm">{t('error', { code: check.errorCode ?? '' })}</p>}
                      {check.status === 'not_applicable' && check.service === 'pi' && (
                        <p className="mt-1 text-sm text-muted-foreground">{t('notApplicablePi')}</p>
                      )}
                    </div>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
      <p className="text-xs text-muted-foreground">{t('startQueryNote')}</p>
    </div>
  );
}
