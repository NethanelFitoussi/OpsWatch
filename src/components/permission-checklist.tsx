import { CircleCheck, CircleMinus, CircleX, TriangleAlert } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';
import { SERVICE_ICONS, ServiceIconImage } from '@/components/aws-icon';
import { knownIdentityError } from '@/lib/aws/identity-errors';
import type { CheckStatus, PermissionTestResult } from '@/lib/connections/types';
import { TONE_BORDER, TONE_SOFT, TONE_TEXT } from '@/lib/ui/tones';
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
    return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t('neverRun')}</p>;
  }

  if (result.identityError) {
    const code = result.identityError;
    const known = knownIdentityError(code);
    return (
      <div role="status" className={cn('rounded-lg border p-4 text-sm', TONE_BORDER.danger, TONE_SOFT.danger)}>
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
          <h3 id={`region-${region}`} className="mb-2 font-mono text-xs font-medium tracking-wide text-muted-foreground uppercase">{region}</h3>
          <ul className="divide-y overflow-hidden rounded-lg border">
            {result.checks
              .filter((c) => c.region === region)
              .map((check) => {
                const { icon: Icon, className } = ICONS[check.status];
                return (
                  <li key={check.service} className="flex items-start gap-3 p-3 sm:gap-4 sm:p-4">
                    <ServiceIconImage icon={SERVICE_ICONS[check.service][0]} size={32} className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <p className="font-medium">{services(check.service)}</p>
                        <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Icon className={cn('size-4 shrink-0', className)} aria-hidden />
                          {t(`statuses.${check.status}`)}
                        </p>
                      </div>
                      <p className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{check.action}</p>
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
