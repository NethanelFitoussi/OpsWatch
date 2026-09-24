import { Check, CircleHelp, TriangleAlert, X } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { durationSince } from '@/lib/monitoring/shared/duration';
import type { Evaluation } from '@/lib/monitoring/shared/evaluated-health';
import { STATE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

const OUTCOME_ICON = { pass: Check, warn: TriangleAlert, fail: X, unknown: CircleHelp } as const;
const OUTCOME_TONE = { pass: STATE_TEXT.healthy, warn: STATE_TEXT.warning, fail: STATE_TEXT.critical, unknown: STATE_TEXT.unknown } as const;

/**
 * Why OpsWatch says this is healthy — which is a piece of analysis, not the absence of one.
 *
 * "No problems" is what a page says when it has not looked. This lists the checks that actually ran, with
 * their outcomes and the age of the reading, so a green verdict is answerable: an operator can see that
 * twelve of twelve services were evaluated, that CPU and memory were inside their bands, and that the
 * reading is a minute old rather than a day old.
 *
 * Only checks that ran are listed. A check OpsWatch skipped is absent, never a passing one.
 */
export async function HealthySummary({
  evaluation,
  nowMs,
  showVerdict = true,
}: {
  evaluation: Evaluation;
  nowMs: number;
  /** False where the verdict is already the headline beside it, so the page does not agree with itself. */
  showVerdict?: boolean;
}) {
  const t = await getTranslations('Monitoring.estate');
  const checks = await getTranslations('Monitoring.checks');

  if (evaluation.checks.length === 0) {
    return (
      <div className="flex gap-2 text-sm">
        <CircleHelp className={cn('mt-0.5 size-4 shrink-0', STATE_TEXT.unknown)} aria-hidden />
        <div>
          <p className="font-medium">{t('notEvaluated')}</p>
          <p className="text-muted-foreground">{t('notEvaluatedHint')}</p>
        </div>
      </div>
    );
  }

  const age = evaluation.evaluatedAt === null ? null : durationSince(evaluation.evaluatedAt, nowMs);
  return (
    <div className="space-y-3">
      {showVerdict && <p className={cn('text-sm font-medium', STATE_TEXT[evaluation.state])}>{t(`verdict.${evaluation.state}`)}</p>}
      <ul className="space-y-1.5">
        {evaluation.checks.map((check) => {
          const Icon = OUTCOME_ICON[check.outcome];
          return (
            <li key={check.id} className="flex gap-2 text-sm">
              <Icon className={cn('mt-0.5 size-4 shrink-0', OUTCOME_TONE[check.outcome])} aria-hidden />
              <span>{checks(check.id, check.values ?? {})}</span>
            </li>
          );
        })}
      </ul>
      {/* What OpsWatch tried to read and could not. Listing it is what keeps the list above from reading
          as the whole story — and it is why this resource is not green. */}
      {evaluation.unread.length > 0 && (
        <ul className="space-y-1.5">
          {evaluation.unread.map((signal) => (
            <li key={signal} className="flex gap-2 text-sm text-muted-foreground">
              <CircleHelp className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{t('unread', { signal: checks(`${signal}.name`) })}</span>
            </li>
          ))}
        </ul>
      )}
      {/* Without this line the list above is a claim about an unstated moment. */}
      {age !== null && (
        <p className="text-xs text-muted-foreground">
          {evaluation.state === 'stale' ? t(`staleSince.${age.unit}`, { value: age.value }) : t(`evaluated.${age.unit}`, { value: age.value })}
        </p>
      )}
    </div>
  );
}
