import type { AlarmSummary } from '@/lib/monitoring/alarms';
import type { MetricFamily } from '@/lib/monitoring/shared/metric-catalogue';

/**
 * What to call an alarm, in a sentence that is true of the state it is actually in.
 *
 * The metric catalogue's title is written for the state the alarm exists to catch — "CPU reservation is
 * above its threshold". Printing that over an alarm sitting at OK made the list claim the opposite of
 * what the row's own colour said, and "Database connections crossed the threshold" appeared under the
 * heading *Healthy*. A monitoring tool that says the wrong thing confidently is worse than one that says
 * less.
 *
 * So the family's sentence is used only where it is true, and the other two states get their own,
 * composed from the metric's name. Shared by the row and the detail so the two can never disagree.
 */
export function alarmTitle(
  alarm: Pick<AlarmSummary, 'state' | 'type' | 'name'>,
  family: MetricFamily | null,
  metricPhrase: string | null,
  t: {
    family: (id: string) => string;
    firing: (metric: string) => string;
    within: (metric: string) => string;
    unevaluated: (metric: string) => string;
    composite: () => string;
    noMetric: (state: AlarmSummary['state']) => string;
  },
): string {
  if (alarm.type === 'composite') return t.composite();
  if (metricPhrase === null && family === null) {
    // Nothing to say it with. The alarm's own name is the last resort, and only for a firing alarm is
    // there anything worth leading with at all.
    return alarm.state === 'ALARM' ? alarm.name : t.noMetric(alarm.state);
  }
  if (alarm.state === 'ALARM') return family === null ? t.firing(metricPhrase ?? alarm.name) : t.family(family.id);
  const metric = metricPhrase ?? (family === null ? alarm.name : t.family(family.id));
  return alarm.state === 'OK' ? t.within(metric) : t.unevaluated(metric);
}
