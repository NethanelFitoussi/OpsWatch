/**
 * Pure helpers for the synthetics screens: status presentation, failure-first ordering, summary counts and
 * certificate expiry classification.
 */
import type { SyntheticSummary } from '@/api/contract';
import type { MessageKey } from '@/i18n';
import type { IconName } from '@/ui/layout';
import type { Tone } from '@/ui/theme';

export type SyntheticStatus = SyntheticSummary['status'];

const DAY = 24 * 3_600_000;
export const SSL_WARNING_DAYS = 30;
export const SSL_CRITICAL_DAYS = 7;

const STATUS_META: Record<SyntheticStatus, { tone: Tone; icon: IconName; label: MessageKey }> = {
  up: { tone: 'healthy', icon: 'checkmark-circle', label: 'synthetics.status.up' },
  degraded: { tone: 'warning', icon: 'warning', label: 'synthetics.status.degraded' },
  down: { tone: 'critical', icon: 'close-circle', label: 'synthetics.status.down' },
  unknown: { tone: 'unknown', icon: 'help-circle', label: 'synthetics.status.unknown' },
};

export function syntheticStatusMeta(status: SyntheticStatus) {
  return STATUS_META[status];
}

/** Failures first: down, degraded, unknown, then up; alphabetical inside a group. */
const RANK: Record<SyntheticStatus, number> = { down: 0, degraded: 1, unknown: 2, up: 3 };

export function sortFailuresFirst<T extends Pick<SyntheticSummary, 'status' | 'name'>>(items: T[]): T[] {
  return [...items].sort((a, b) => RANK[a.status] - RANK[b.status] || a.name.localeCompare(b.name));
}

export function statusCounts(items: Pick<SyntheticSummary, 'status'>[]): Record<SyntheticStatus, number> {
  const counts: Record<SyntheticStatus, number> = { up: 0, degraded: 0, down: 0, unknown: 0 };
  for (const item of items) counts[item.status] += 1;
  return counts;
}

/** The host of a check target, or the target itself when it is not a URL. */
export function targetHost(target: string): string {
  try {
    const host = new URL(target).host;
    return host || target;
  } catch {
    return target;
  }
}

export type SslLevel = 'ok' | 'warning' | 'critical' | 'expired' | 'invalid' | 'unknown';
export type SslState = { level: SslLevel; days: number | null };

/**
 * Certificate state: invalid when the check says so, expired when past its date, critical under 7 days, warning under
 * 30 days. `days` is whole days left, rounded down so the warning never looks later than it is.
 */
export function classifySsl(ssl: SyntheticSummary['ssl'], now: number): SslState {
  if (!ssl) return { level: 'unknown', days: null };
  const days = ssl.expiresAt === null ? null : Math.floor((ssl.expiresAt - now) / DAY);
  if (ssl.valid === false) return { level: 'invalid', days };
  if (ssl.expiresAt === null || days === null) return { level: ssl.valid === true ? 'ok' : 'unknown', days: null };
  if (ssl.expiresAt <= now) return { level: 'expired', days };
  if (days < SSL_CRITICAL_DAYS) return { level: 'critical', days };
  if (days < SSL_WARNING_DAYS) return { level: 'warning', days };
  return { level: ssl.valid === true ? 'ok' : 'unknown', days };
}

/** Levels that deserve a visible flag in the list. */
export function sslNeedsAttention(state: SslState): boolean {
  return state.level === 'warning' || state.level === 'critical' || state.level === 'expired' || state.level === 'invalid';
}

export function sslTone(level: SslLevel): Tone {
  switch (level) {
    case 'ok':
      return 'healthy';
    case 'warning':
      return 'warning';
    case 'critical':
    case 'expired':
    case 'invalid':
      return 'critical';
    case 'unknown':
      return 'unknown';
  }
}

/** The one-line certificate message, for example "Certificate expires in 12 days". */
export function sslMessage(state: SslState): { key: MessageKey; params?: Record<string, number> } {
  switch (state.level) {
    case 'invalid':
      return { key: 'synthetics.ssl.invalidShort' };
    case 'expired':
      return { key: 'synthetics.ssl.expired' };
    case 'unknown':
      return { key: 'synthetics.ssl.unknown' };
    default:
      if (state.days === null) return { key: 'synthetics.ssl.validShort' };
      if (state.days < 1) return { key: 'synthetics.ssl.expiresWithinDay' };
      return { key: state.days === 1 ? 'synthetics.ssl.expiresInOne' : 'synthetics.ssl.expiresIn', params: { days: state.days } };
  }
}
