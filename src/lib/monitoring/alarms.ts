import 'server-only';
import { CloudWatchClient, DescribeAlarmsCommand, type CompositeAlarm, type MetricAlarm } from '@aws-sdk/client-cloudwatch';
import { clientConfig } from '../aws/client-config';
import { SEARCH_MAX } from '../limits';
import { sendWithTimeout } from '../aws/timeout';
import { isOneOf } from '../type-guards';
import { ALARM_SERVICES, changedWithin, serviceOf } from './shared/alarm-facts';
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
  /**
   * The rest of the condition, which `DescribeAlarms` already returns and the page was throwing away.
   *
   * Without them a reader cannot tell "over 80% once" from "over 80% for fifteen minutes", and those are
   * different alarms. No new permission: this is the same call, mapped properly.
   */
  description: string | null;
  statistic: string | null;
  /** Seconds per datapoint. */
  period: number | null;
  evaluationPeriods: number | null;
  /** How many of the evaluation periods must breach. Null means AWS uses all of them. */
  datapointsToAlarm: number | null;
  unit: string | null;
  /** What AWS does when there is not enough data, which is why an alarm can sit in INSUFFICIENT_DATA. */
  treatMissingData: string | null;
};

const TARGET_TRACKING_PREFIX = 'TargetTracking-';
const isTargetTrackingAlarm = (name: string): boolean => name.startsWith(TARGET_TRACKING_PREFIX);

const STATES = ['OK', 'ALARM', 'INSUFFICIENT_DATA'] as const;
const STATE_ORDER: Record<AlarmState, number> = { ALARM: 0, INSUFFICIENT_DATA: 1, OK: 2 };
const MAX_PAGES = 50;

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
    description: a.AlarmDescription ?? null,
    statistic: a.Statistic ?? a.ExtendedStatistic ?? null,
    period: a.Period ?? null,
    evaluationPeriods: a.EvaluationPeriods ?? null,
    datapointsToAlarm: a.DatapointsToAlarm ?? null,
    unit: a.Unit ?? null,
    treatMissingData: a.TreatMissingData ?? null,
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
    // A composite alarm has no metric of its own: it is a rule over other alarms, and the fields below
    // belong to a metric. Null rather than zero, so nothing renders "0 evaluation periods".
    description: a.AlarmDescription ?? null,
    statistic: null,
    period: null,
    evaluationPeriods: null,
    datapointsToAlarm: null,
    unit: null,
    treatMissingData: null,
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
export type AlarmFilter = {
  state: (typeof ALARM_STATE_FILTERS)[number];
  showTargetTracking: boolean;
  search: string;
  /** One service, derived from the namespace. `all` is every service, not a service called "all". */
  service: string;
  /** Only alarms whose state AWS changed inside `RECENTLY_MS`. */
  recent: boolean;
};

/** What "recently changed" means. Long enough to cover a deploy, short enough to still be news. */
const RECENTLY_MS = 60 * 60_000;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseAlarmFilter(params: {
  state?: string | string[];
  tt?: string | string[];
  q?: string | string[];
  svc?: string | string[];
  recent?: string | string[];
}): AlarmFilter {
  const stateParam = first(params.state);
  const q = first(params.q) ?? '';
  const service = first(params.svc);
  return {
    service: service !== undefined && isOneOf(ALARM_SERVICES, service) ? service : 'all',
    recent: first(params.recent) === '1',
    state: isOneOf(ALARM_STATE_FILTERS, stateParam) ? stateParam : ALARM_STATE_FILTERS[0],
    showTargetTracking: first(params.tt) === '1',
    search: q.trim().slice(0, SEARCH_MAX),
  };
}

export function filterAlarms(alarms: readonly AlarmSummary[], filter: AlarmFilter, nowMs = Date.now()): AlarmSummary[] {
  const search = filter.search.toLowerCase();
  return alarms.filter(
    (a) =>
      (filter.showTargetTracking || !a.targetTracking) &&
      (filter.state === 'all' || a.state === filter.state) &&
      (filter.service === 'all' || serviceOf(a) === filter.service) &&
      (!filter.recent || changedWithin(a, nowMs, RECENTLY_MS)) &&
      // The AWS name stays searchable even though the row leads with a readable title: it is what an
      // operator has in a runbook, a ticket or somebody else's console.
      (search === '' ||
        a.name.toLowerCase().includes(search) ||
        (a.metricName ?? '').toLowerCase().includes(search) ||
        (a.namespace ?? '').toLowerCase().includes(search) ||
        Object.values(a.dimensions).some((value) => value.toLowerCase().includes(search))),
  );
}
