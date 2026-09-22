/**
 * Pure helpers for the alert screens: filter mapping, status presentation, durations and history ordering.
 */
import type { AlertDetail, AlertSummary, Series } from '@/api/contract';
import type { AlertFilters } from '@/api/client';
import type { MessageKey } from '@/i18n';
import type { IconName } from '@/ui/layout';
import type { Tone } from '@/ui/theme';

export type AlertStatus = AlertSummary['status'];
export type AlertTab = 'active' | 'acknowledged' | 'resolved' | 'history';

export const ALERT_TABS: { value: AlertTab; label: MessageKey }[] = [
  { value: 'active', label: 'alerts.filter.active' },
  { value: 'acknowledged', label: 'alerts.filter.acknowledged' },
  { value: 'resolved', label: 'alerts.filter.resolved' },
  { value: 'history', label: 'alerts.filter.history' },
];

/** "Active" means firing; "History" asks the server for every alert whatever its state. */
export function filtersForTab(tab: AlertTab): AlertFilters {
  switch (tab) {
    case 'active':
      return { status: 'firing' };
    case 'acknowledged':
      return { status: 'acknowledged' };
    case 'resolved':
      return { status: 'resolved' };
    case 'history':
      return { status: 'history' };
  }
}

export function emptyForTab(tab: AlertTab): { title: MessageKey; body: MessageKey } {
  return tab === 'active' ? { title: 'alerts.empty.active', body: 'alerts.empty.activeBody' } : { title: 'alerts.empty.other', body: 'alerts.empty.otherBody' };
}

const STATUS_META: Record<AlertStatus, { tone: Tone; icon: IconName; label: MessageKey }> = {
  firing: { tone: 'critical', icon: 'notifications', label: 'alerts.status.firing' },
  acknowledged: { tone: 'unknown', icon: 'eye-outline', label: 'alerts.status.acknowledged' },
  resolved: { tone: 'healthy', icon: 'checkmark-circle', label: 'alerts.status.resolved' },
  insufficient_data: { tone: 'unknown', icon: 'help-circle', label: 'alerts.status.insufficient_data' },
};

export function alertStatusMeta(status: AlertStatus) {
  return STATUS_META[status];
}

/** Firing, acknowledged and insufficient_data are live states; only "resolved" is over. */
export function isAlertOngoing(status: AlertStatus): boolean {
  return status !== 'resolved';
}

/**
 * How long the alert has been going, or null when that cannot be said: no start time, or the alert is resolved and
 * the contract carries no end time, so "for 26 h" would be a claim the data does not support.
 */
export function alertDurationMs(alert: Pick<AlertSummary, 'since' | 'status'>, now: number): number | null {
  if (alert.since === null || !isAlertOngoing(alert.status)) return null;
  return Math.max(0, now - alert.since);
}

/** The most recent point that has a value: a trailing gap is "no data", never the last known number nor 0. */
export function latestValue(series: Series | undefined): number | null {
  if (!series) return null;
  for (let i = series.points.length - 1; i >= 0; i -= 1) {
    const value = series.points[i]?.[1];
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

/** State history, oldest first. */
export function chronologicalHistory(history: AlertDetail['history']): AlertDetail['history'] {
  return [...history].sort((a, b) => a.at - b.at);
}

export function canAcknowledge(alert: Pick<AlertDetail, 'allowedActions'>): boolean {
  return alert.allowedActions.includes('acknowledge');
}
