/**
 * Formatting shared by every screen: numbers with units, relative times, durations, percentages.
 * `null` always renders as an em dash (the "No data" label is added by the calling component), never as 0.
 */
import type { MetricUnit } from '@/api/contract';

export const NO_DATA = '—';

type FormatLocale = 'en' | 'fr';
const UNITS: Record<FormatLocale, { s: string; min: string; h: string; d: string; numberLocale: string }> = {
  en: { s: 's', min: 'min', h: 'h', d: 'd', numberLocale: 'en-US' },
  fr: { s: 's', min: 'min', h: 'h', d: 'j', numberLocale: 'fr-FR' },
};
let formatLocale: FormatLocale = 'en';

/** Set once by the i18n provider: formatting follows the app language. Pure helpers stay locale-free to call. */
export function setFormatLocale(locale: FormatLocale): void {
  formatLocale = locale;
}
const units = () => UNITS[formatLocale];

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function trimNumber(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0+$|(\.\d*[1-9])0+$/, '$1');
}

export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${trimNumber(value / 1e9, 1)}B`;
  if (abs >= 1e6) return `${trimNumber(value / 1e6, 1)}M`;
  if (abs >= 1e4) return `${trimNumber(value / 1e3, 1)}k`;
  if (abs >= 1000) return value.toLocaleString(units().numberLocale, { maximumFractionDigits: 0 });
  if (abs >= 100) return trimNumber(value, 0);
  if (abs >= 10) return trimNumber(value, 1);
  return trimNumber(value, 2);
}

export function formatMetric(value: number | null | undefined, unit: MetricUnit): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_DATA;
  switch (unit) {
    case 'percent':
      return `${trimNumber(value, Math.abs(value) < 10 ? 1 : 0)} %`;
    case 'ratio':
      return formatPercentFraction(value);
    case 'ms':
      return value >= 1000 ? `${trimNumber(value / 1000, 2)} s` : `${trimNumber(value, value < 10 ? 1 : 0)} ms`;
    case 'seconds':
      return formatDuration(value * 1000);
    case 'per_minute':
      return `${formatCompact(value)}/min`;
    case 'per_second':
      return `${formatCompact(value)}/s`;
    case 'bytes':
      return formatBytes(value);
    case 'count':
    case 'none':
      return formatCompact(value);
  }
}

/** 0.9962 → "99.62 %". Keeps enough digits to tell 99.9 % from 99.95 %. */
export function formatPercentFraction(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_DATA;
  const pct = value * 100;
  const digits = Math.abs(pct) >= 99 && Math.abs(pct) < 100 ? 2 : Math.abs(pct) < 10 ? 1 : 1;
  return `${trimNumber(pct, digits)} %`;
}

export function formatBytes(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = value;
  let i = 0;
  while (Math.abs(v) >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${trimNumber(v, v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatDuration(ms: number): string {
  const u = units();
  const abs = Math.max(0, ms);
  if (abs < MIN) return `${Math.round(abs / 1000)} ${u.s}`;
  if (abs < HOUR) return `${Math.round(abs / MIN)} ${u.min}`;
  if (abs < DAY) {
    const h = Math.floor(abs / HOUR);
    const m = Math.round((abs % HOUR) / MIN);
    return m ? `${h} ${u.h} ${m} ${u.min}` : `${h} ${u.h}`;
  }
  const d = Math.floor(abs / DAY);
  const h = Math.round((abs % DAY) / HOUR);
  return h ? `${d} ${u.d} ${h} ${u.h}` : `${d} ${u.d}`;
}

export type RelativeTimeLabels = { now: string; ago: (amount: string) => string; in: (amount: string) => string };

const EN_RELATIVE: RelativeTimeLabels = { now: 'just now', ago: (a) => `${a} ago`, in: (a) => `in ${a}` };

/** "3 min ago", "in 12 d". Rounded down so data never looks fresher than it is. */
export function formatRelative(at: number, now: number, labels: RelativeTimeLabels = EN_RELATIVE): string {
  const diff = now - at;
  const abs = Math.abs(diff);
  if (abs < 45_000) return labels.now;
  const u = units();
  let amount: string;
  if (abs < HOUR) amount = `${Math.floor(abs / MIN)} ${u.min}`;
  else if (abs < DAY) amount = `${Math.floor(abs / HOUR)} ${u.h}`;
  else amount = `${Math.floor(abs / DAY)} ${u.d}`;
  return diff >= 0 ? labels.ago(amount) : labels.in(amount);
}

export function formatClock(at: number, locale?: string): string {
  return new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(at: number, locale?: string): string {
  return new Date(at).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** Pretty-prints a log line when it is JSON, otherwise returns it untouched. */
/** Above this a log line is shown as it came: parsing and re-printing megabytes helps nobody. */
export const MAX_PRETTY_LOG_LENGTH = 100_000;

export function prettyLog(message: string): { pretty: string; isJson: boolean } {
  if (message.length > MAX_PRETTY_LOG_LENGTH) return { pretty: message, isJson: false };
  const trimmed = message.trim();
  if (!(trimmed.startsWith('{') && trimmed.endsWith('}')) && !(trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return { pretty: message, isJson: false };
  }
  try {
    return { pretty: JSON.stringify(JSON.parse(trimmed), null, 2), isJson: true };
  } catch {
    return { pretty: message, isJson: false };
  }
}

/** One-line preview of a log line: the `msg`/`message` of a JSON line when there is one. */
export function logPreview(message: string): string {
  const { isJson } = prettyLog(message);
  if (!isJson) return message;
  try {
    const parsed = JSON.parse(message) as Record<string, unknown>;
    const main = parsed.msg ?? parsed.message ?? parsed.error;
    return typeof main === 'string' ? main : message;
  } catch {
    return message;
  }
}
