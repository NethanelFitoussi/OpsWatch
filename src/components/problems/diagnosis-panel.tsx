import { ArrowRight } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import type { Check, DetectionRule, Impact, Recovery, Unit } from '@/lib/detect/explain';

/**
 * Why this problem exists, what it can be said to have affected, and what to look at (§2.6, §7).
 *
 * The page it sits on used to answer "what did the detector measure" and nothing else, which left an
 * operator to reverse-engineer why a number was a Warning. Three cards answer that instead — and each one
 * is allowed to say it does not know, because the alternative is a product that sounds certain and is not.
 */

/** Numbers, in the unit the rule measured. Rendered with the locale's separators rather than raw. */
function Measure({ value, unit }: { value: number; unit: Unit }) {
  const format = useFormatter();
  const t = useTranslations('Monitoring.diagnosis');
  if (unit === 'percent') return <>{t('percent', { value: Number(value.toFixed(2)) })}</>;
  if (unit === 'ms') return <>{t('ms', { value: Math.round(value) })}</>;
  return <>{format.number(Math.round(value))}</>;
}

/** A labelled figure. The unit is part of the value, so a bare number never has to be guessed at. */
function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * Why OpsWatch opened this.
 *
 * Three shapes, told apart rather than blurred: a fixed threshold, a presence check with no threshold to
 * quote, and a state AWS reported rather than a measurement OpsWatch took.
 */
export function WhyPanel({ rule, recovery }: { rule: DetectionRule | null; recovery: Recovery }) {
  const t = useTranslations('Monitoring.diagnosis');
  if (rule === null) return null;

  return (
    <MonitoringCard title={t('why')}>
      {rule.kind === 'threshold' && (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Figure label={t('observed')}>
              <Measure value={rule.observed} unit={rule.unit} />
            </Figure>
            <Figure label={t('threshold')}>
              <Measure value={rule.threshold} unit={rule.unit} />
            </Figure>
            {/* Only where the rule has a clearing margin: the number it must come back *under* is not the
                number it crossed, and saying so is how somebody knows when it is over. */}
            {recovery?.clearAt != null && (
              <Figure label={t('clearsUnder')}>
                <Measure value={recovery.clearAt} unit={recovery.unit} />
              </Figure>
            )}
          </dl>
          <p className="mt-3 text-sm text-muted-foreground">{t('fixedRule')}</p>
        </>
      )}
      {rule.kind === 'presence' && (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Figure label={t('observed')}>
              <Measure value={rule.observed} unit={rule.unit} />
            </Figure>
          </dl>
          <p className="mt-3 text-sm text-muted-foreground">{t('presenceRule')}</p>
        </>
      )}
      {rule.kind === 'state' && <p className="text-sm text-muted-foreground">{t('stateRule')}</p>}
      {/* §33.5's lifecycle, which is what actually closes a problem. */}
      <p className="mt-2 text-sm text-muted-foreground">{t('lifecycle')}</p>
    </MonitoringCard>
  );
}

/** What can be established about the damage — and, far more often, what cannot. */
export function ImpactPanel({ impact }: { impact: Impact }) {
  const t = useTranslations('Monitoring.diagnosis');
  const share = impact.requests !== null && impact.requests > 0 && impact.errors !== null ? (impact.errors / impact.requests) * 100 : null;

  return (
    <MonitoringCard title={t('impact')}>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {impact.errors !== null && (
          <Figure label={t('failedRequests')}>
            <Measure value={impact.errors} unit="count" />
          </Figure>
        )}
        {impact.requests !== null && (
          <Figure label={t('requests')}>
            <Measure value={impact.requests} unit="count" />
          </Figure>
        )}
        {share !== null && (
          <Figure label={t('errorShare')}>
            <Measure value={share} unit="percent" />
          </Figure>
        )}
        {/* Null and zero are different answers, and §33.7 already keeps them apart in the score. */}
        {impact.blastShare !== null && (
          <Figure label={t('blast')}>
            <Measure value={impact.blastShare * 100} unit="percent" />
          </Figure>
        )}
      </dl>
      {/* The sentence this whole card exists for. OpsWatch does not read what a person saw. */}
      <p className="mt-3 text-sm">
        {impact.established ? t('userImpactMeasured') : <strong className="font-medium">{t('userImpactUnknown')}</strong>}
      </p>
      {!impact.established && <p className="mt-1 text-sm text-muted-foreground">{t('userImpactHint')}</p>}
    </MonitoringCard>
  );
}

/**
 * What to look at, in the order the evidence justifies.
 *
 * Every entry carries the evidence that produced it, because a checklist that cannot say *why* is one an
 * operator learns to scroll past. An empty list is an answer too, and it says so.
 */
export function ChecksPanel({ checks }: { checks: Check[] }) {
  const t = useTranslations('Monitoring.diagnosis');

  return (
    <MonitoringCard title={t('whatToCheck')}>
      {checks.length === 0 ? (
        <>
          <p className="text-sm">{t('noChecks')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('noChecksHint')}</p>
        </>
      ) : (
        <ol className="divide-y">
          {checks.map((check, index) => (
            <li key={check.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="flex min-w-0 gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t(`action.${check.action}`)}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{t(`reason.${check.reasonKey}`, check.reasonValues)}</p>
                </div>
              </div>
              {check.href !== null && (
                <Link
                  href={check.href}
                  className="inline-flex shrink-0 items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
                >
                  {t(`cta.${check.action}`)} <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              )}
            </li>
          ))}
        </ol>
      )}
    </MonitoringCard>
  );
}
