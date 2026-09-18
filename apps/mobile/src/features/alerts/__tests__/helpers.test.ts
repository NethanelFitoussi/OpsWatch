import { alertDurationMs, alertStatusMeta, canAcknowledge, chronologicalHistory, emptyForTab, filtersForTab } from '../helpers';

describe('alert helpers', () => {
  it('maps the tabs to server filters, Active meaning firing', () => {
    expect(filtersForTab('active')).toEqual({ status: 'firing' });
    expect(filtersForTab('acknowledged')).toEqual({ status: 'acknowledged' });
    expect(filtersForTab('resolved')).toEqual({ status: 'resolved' });
    expect(filtersForTab('history')).toEqual({ status: 'history' });
  });

  it('has a specific empty state for active alerts', () => {
    expect(emptyForTab('active').title).toBe('alerts.empty.active');
    expect(emptyForTab('history').title).toBe('alerts.empty.other');
  });

  it('gives every status an icon, a tone and a word', () => {
    expect(alertStatusMeta('firing')).toEqual({ tone: 'critical', icon: 'notifications', label: 'alerts.status.firing' });
    expect(alertStatusMeta('resolved').tone).toBe('healthy');
    expect(alertStatusMeta('acknowledged').label).toBe('alerts.status.acknowledged');
    expect(alertStatusMeta('insufficient_data').tone).toBe('unknown');
  });

  it('computes the duration only when the start is known', () => {
    expect(alertDurationMs({ since: 1_000 }, 61_000)).toBe(60_000);
    expect(alertDurationMs({ since: null }, 61_000)).toBeNull();
    expect(alertDurationMs({ since: 90_000 }, 61_000)).toBe(0);
  });

  it('orders history oldest first without mutating the input', () => {
    const history = [{ at: 3, status: 'ALARM' }, { at: 1, status: 'OK' }];
    expect(chronologicalHistory(history).map((h) => h.at)).toEqual([1, 3]);
    expect(history[0]!.at).toBe(3);
  });

  it('allows acknowledging only when the server says so', () => {
    expect(canAcknowledge({ allowedActions: ['acknowledge'] })).toBe(true);
    expect(canAcknowledge({ allowedActions: [] })).toBe(false);
  });
});
