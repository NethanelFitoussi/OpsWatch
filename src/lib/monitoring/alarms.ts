import 'server-only';
import { CloudWatchClient, DescribeAlarmsCommand, type CompositeAlarm, type MetricAlarm } from '@aws-sdk/client-cloudwatch';
import { clientConfig } from '../aws/client-config';
import { sendWithTimeout } from '../aws/timeout';
import { isOneOf } from '../type-guards';
import { describeCall, describeTimeout, type AwsTarget, type MonitoringDeps } from './call';
import type { MonitoringResult } from './result';

export type AlarmState = 'OK' | 'ALARM' | 'INSUFFICIENT_DATA';
export type AlarmSummary = {
  name: string;
  type: 'metric' | 'composite';
  state: AlarmState;
  stateReason: string;
  stateUpdatedAt: number | null;
  namespace: string | null;
  metricName: string | null;
  dimensions: Record<string, string>;
  threshold: number | null;
  comparison: string | null;
  targetTracking: boolean;
};

export const TARGET_TRACKING_PREFIX = 'TargetTracking-';
export const isTargetTrackingAlarm = (name: string): boolean => name.startsWith(TARGET_TRACKING_PREFIX);

const STATES = ['OK', 'ALARM', 'INSUFFICIENT_DATA'] as const;
const STATE_ORDER: Record<AlarmState, number> = { ALARM: 0, INSUFFICIENT_DATA: 1, OK: 2 };
const MAX_PAGES = 50;
const SEARCH_MAX = 100;

const state = (value: string | undefined): AlarmState => (isOneOf(STATES, value) ? value : 'INSUFFICIENT_DATA');

function fromMetric(a: MetricAlarm): AlarmSummary {
  const name = a.AlarmName ?? '';
  return {
    name,
    type: 'metric',
    state: state(a.StateValue),
    stateReason: a.StateReason ?? '',
    stateUpdatedAt: a.StateUpdatedTimestamp?.getTime() ?? null,
    namespace: a.Namespace ?? null,
    metricName: a.MetricName ?? null,
    dimensions: Object.fromEntries((a.Dimensions ?? []).map((d) => [d.Name ?? '', d.Value ?? ''])),
    threshold: a.Threshold ?? null,
    comparison: a.ComparisonOperator ?? null,
    targetTracking: isTargetTrackingAlarm(name),
  };
}

function fromComposite(a: CompositeAlarm): AlarmSummary {
  const name = a.AlarmName ?? '';
  return {
    name,
    type: 'composite',
    state: state(a.StateValue),
    stateReason: a.StateReason ?? '',
    stateUpdatedAt: a.StateUpdatedTimestamp?.getTime() ?? null,
    namespace: null,
    metricName: null,
    dimensions: {},
    threshold: null,
    comparison: null,
    targetTracking: isTargetTrackingAlarm(name),
  };
}

export function listAlarms(target: AwsTarget, deps: MonitoringDeps = {}): Promise<MonitoringResult<AlarmSummary[]>> {
  return describeCall(target, 'cloudwatch:DescribeAlarms', {}, async () => {
    const client = new CloudWatchClient(clientConfig(target.region, target.credentials));
    const alarms: AlarmSummary[] = [];
    let NextToken: string | undefined;
    let pages = 0;
    do {
      const out = await sendWithTimeout(
        client,
        new DescribeAlarmsCommand({ AlarmTypes: ['MetricAlarm', 'CompositeAlarm'], MaxRecords: 100, ...(NextToken ? { NextToken } : {}) }),
        describeTimeout(deps),
      );
      alarms.push(...(out.MetricAlarms ?? []).map(fromMetric), ...(out.CompositeAlarms ?? []).map(fromComposite));
      NextToken = out.NextToken;
      pages += 1;
    } while (NextToken && pages < MAX_PAGES);
    return alarms.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name, 'en'));
  }, deps);
}

export const ALARM_STATE_FILTERS = ['all', 'ALARM', 'OK', 'INSUFFICIENT_DATA'] as const;
export type AlarmFilter = { state: (typeof ALARM_STATE_FILTERS)[number]; showTargetTracking: boolean; search: string };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseAlarmFilter(params: { state?: string | string[]; tt?: string | string[]; q?: string | string[] }): AlarmFilter {
  const stateParam = first(params.state);
  const q = first(params.q) ?? '';
  return {
    state: isOneOf(ALARM_STATE_FILTERS, stateParam) ? stateParam : ALARM_STATE_FILTERS[0],
    showTargetTracking: first(params.tt) === '1',
    search: q.trim().slice(0, SEARCH_MAX),
  };
}

export function filterAlarms(alarms: readonly AlarmSummary[], filter: AlarmFilter): AlarmSummary[] {
  const search = filter.search.toLowerCase();
  return alarms.filter(
    (a) =>
      (filter.showTargetTracking || !a.targetTracking) &&
      (filter.state === 'all' || a.state === filter.state) &&
      (search === '' || a.name.toLowerCase().includes(search)),
  );
}

export const COMPARISON_SYMBOLS: Record<string, string> = {
  GreaterThanThreshold: '>',
  GreaterThanOrEqualToThreshold: '≥',
  LessThanThreshold: '<',
  LessThanOrEqualToThreshold: '≤',
};
