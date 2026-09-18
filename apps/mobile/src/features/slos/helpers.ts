/**
 * Pure helpers for the SLO screens: status presentation, target/current text, error budget and burn rate wording.
 * A missing value is never shown as 0.
 */
import type { SloSummary } from '@/api/contract';
import type { MessageKey } from '@/i18n';
import { formatCompact, formatPercentFraction } from '@/lib/format';
import type { IconName } from '@/ui/layout';
import type { Tone } from '@/ui/theme';

export type SloStatus = SloSummary['status'];

const STATUS_META: Record<SloStatus, { tone: Tone; icon: IconName; label: MessageKey }> = {
  healthy: { tone: 'healthy', icon: 'checkmark-circle', label: 'slos.status.healthy' },
  at_risk: { tone: 'warning', icon: 'warning', label: 'slos.status.at_risk' },
  breached: { tone: 'critical', icon: 'alert-circle', label: 'slos.status.breached' },
  unknown: { tone: 'unknown', icon: 'help-circle', label: 'slos.status.unknown' },
};

export function sloStatusMeta(status: SloStatus) {
  return STATUS_META[status];
}

/** 0.999 → "99.9 %"; null → null so the caller shows "No data". */
export function percentOrNull(value: number | null): string | null {
  return value === null ? null : formatPercentFraction(value);
}

export function isBudgetExhausted(remaining: number | null): boolean {
  return remaining !== null && remaining <= 0;
}

/** Budget line: exhausted, a percentage left, or no data. */
export function budgetText(remaining: number | null): { key: MessageKey; params?: Record<string, string> } {
  if (remaining === null) return { key: 'metric.noData' };
  if (remaining <= 0) return { key: 'slos.budgetExhausted' };
  return { key: 'slos.budgetLeft', params: { value: formatPercentFraction(remaining) } };
}

/** "×14.2" or null when there is no burn rate. */
export function formatBurnRate(rate: number | null): string | null {
  if (rate === null || !Number.isFinite(rate)) return null;
  return `×${formatCompact(rate)}`;
}

/**
 * One-line explanation of the burn rate. Above 1, the budget would last 1/rate of the window; at or below 1 it lasts
 * the whole window.
 */
export function burnRateExplanation(rate: number | null): { key: MessageKey; params?: Record<string, string> } {
  if (rate === null || !Number.isFinite(rate)) return { key: 'slos.burnRateNoData' };
  const value = formatCompact(rate);
  if (rate > 1) return { key: 'slos.burnRateFast', params: { rate: value } };
  return { key: 'slos.burnRateSlow', params: { rate: value } };
}
