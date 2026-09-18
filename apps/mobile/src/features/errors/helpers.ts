/**
 * Pure helpers for the Errors screens: status labels, tones and icons, filter mapping, and counts that keep `null`
 * distinct from zero.
 */
import type { ErrorFilters } from '@/api/client';
import type { ErrorSummary } from '@/api/contract';
import type { MessageKey } from '@/i18n';
import { formatCompact } from '@/lib/format';
import type { IconName } from '@/ui/layout';
import type { Tone } from '@/ui/theme';

export type ErrorStatus = ErrorSummary['status'];
export type ErrorStatusFilter = 'all' | ErrorStatus;

/** Chip order on the list screen. "All" first, then the states that need attention. */
export const ERROR_STATUS_FILTERS: readonly ErrorStatusFilter[] = ['all', 'new', 'regression', 'recurring', 'resolved'];

export function errorStatusLabelKey(status: ErrorStatus): MessageKey {
  return `errors.status.${status}`;
}

export function errorFilterLabelKey(filter: ErrorStatusFilter): MessageKey {
  return filter === 'all' ? 'filter.all' : `errors.filter.${filter}`;
}

const STATUS_TONES: Record<ErrorStatus, Tone> = {
  regression: 'critical',
  new: 'warning',
  recurring: 'info',
  resolved: 'healthy',
};

const STATUS_ICONS: Record<ErrorStatus, IconName> = {
  regression: 'arrow-undo-circle',
  new: 'add-circle',
  recurring: 'repeat',
  resolved: 'checkmark-circle',
};

export function errorStatusTone(status: ErrorStatus): Tone {
  return STATUS_TONES[status];
}

export function errorStatusIcon(status: ErrorStatus): IconName {
  return STATUS_ICONS[status];
}

/** Builds the query filters from the chip selection and the optional `?service=` route parameter. */
export function errorFiltersFor(filter: ErrorStatusFilter, service?: string | null): ErrorFilters {
  const out: ErrorFilters = {};
  if (filter !== 'all') out.status = filter;
  if (service) out.service = service;
  return out;
}

/** A count for display, or `null` when the server could not measure it (rendered as "No data", never 0). */
export function formatCount(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return formatCompact(value);
}
