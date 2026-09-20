import { translate } from '@/i18n';
import { chronological, incidentDurationText, incidentStatusMeta, isOngoing, isSameDay, serviceNames, timelineTypeKey } from '../helpers';

const MIN = 60_000;
const now = 1_000 * MIN;

describe('incident helpers', () => {
  it('describes an ongoing incident as "for 40 min"', () => {
    const text = incidentDurationText({ status: 'investigating', startedAt: now - 40 * MIN, resolvedAt: null }, now);
    expect(translate('en', text.key, text.params)).toBe('for 40 min');
  });

  it('describes a resolved incident by its total duration', () => {
    const text = incidentDurationText({ status: 'resolved', startedAt: now - 100 * MIN, resolvedAt: now - 85 * MIN }, now);
    expect(translate('en', text.key, text.params)).toBe('lasted 15 min');
    expect(translate('fr', text.key, text.params)).toBe('a duré 15 min');
  });

  it('does not invent a duration for a resolved incident without an end time', () => {
    const text = incidentDurationText({ status: 'resolved', startedAt: now - 100 * MIN, resolvedAt: null }, now);
    expect(text.key).toBe('incidents.durationUnknown');
    expect(isOngoing({ status: 'resolved', resolvedAt: null })).toBe(false);
    expect(isOngoing({ status: 'mitigated', resolvedAt: null })).toBe(true);
  });

  it('maps statuses to tones and words', () => {
    expect(incidentStatusMeta('open').tone).toBe('critical');
    expect(incidentStatusMeta('investigating').tone).toBe('warning');
    expect(incidentStatusMeta('mitigated').tone).toBe('info');
    expect(incidentStatusMeta('resolved')).toMatchObject({ tone: 'healthy', label: 'incidents.status.resolved' });
  });

  it('translates known timeline types and keeps unknown ones as sent', () => {
    expect(timelineTypeKey('opened')).toBe('incidents.timeline.opened');
    expect(timelineTypeKey('pager')).toBeNull();
  });

  it('sorts oldest first and lists service names', () => {
    expect(chronological([{ at: 2 }, { at: 1 }]).map((e) => e.at)).toEqual([1, 2]);
    expect(serviceNames({ affectedServices: [{ type: 'service', id: 'svc-a', label: 'a' }, { type: 'service', id: 'svc-b' }] })).toBe('a, svc-b');
  });

  it('tells apart entries of the same day from entries of another one', () => {
    const at = Date.UTC(2026, 8, 20, 13, 30);
    expect(isSameDay(at, at + 30 * MIN)).toBe(true);
    expect(isSameDay(at, at - 26 * 60 * MIN)).toBe(false);
    expect(isSameDay(at, at + 365 * 24 * 60 * MIN)).toBe(false);
  });
});
