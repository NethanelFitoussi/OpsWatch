import { describe, expect, it } from 'vitest';
import {
  COMPARISONS,
  changedWithin,
  breachedDatapoints,
  countStates,
  metricKey,
  reportedValues,
  reasonKind,
  reportedValue,
  resourceOf,
  serviceOf,
  titleParts,
  windowSeconds,
} from '@/lib/monitoring/shared/alarm-facts';

/**
 * Making an alarm legible without inventing anything.
 *
 * Every ruling here is about the line between derived and guessed. A namespace is a fact; a name is
 * whatever somebody typed. A number in AWS's own sentence is a measurement AWS reported; a number that
 * is not there is not a zero.
 */

describe('which service an alarm belongs to', () => {
  it('THE RULING: classifies on the namespace, never on the alarm name', () => {
    // `prod-ecs-backup-rds-lag` is an RDS alarm with "ecs" in its name. Classifying on names would put it
    // in the wrong group with total confidence, which is worse than not grouping at all.
    expect(serviceOf({ namespace: 'AWS/RDS' })).toBe('rds');
    expect(serviceOf({ namespace: 'AWS/ElastiCache' })).toBe('redis');
    expect(serviceOf({ namespace: 'AWS/ApplicationELB' })).toBe('alb');
    expect(serviceOf({ namespace: 'AWS/ECS' })).toBe('ecs');
  });

  it('says "other" for a namespace it does not know, and for one that is missing', () => {
    expect(serviceOf({ namespace: 'Acme/Custom' })).toBe('other');
    // A composite alarm has no namespace at all.
    expect(serviceOf({ namespace: null })).toBe('other');
  });
});

describe('which resource an alarm watches', () => {
  it('picks the dimension an operator recognises, most specific first', () => {
    expect(resourceOf({ dimensions: { ClusterName: 'prod', ServiceName: 'web' } })).toEqual({ dimension: 'ServiceName', value: 'web' });
    expect(resourceOf({ dimensions: { CacheClusterId: 'redis-prod' } })).toEqual({ dimension: 'CacheClusterId', value: 'redis-prod' });
  });

  it('falls back to whatever dimension there is, rather than claiming there is none', () => {
    expect(resourceOf({ dimensions: { Custom: 'thing' } })).toEqual({ dimension: 'Custom', value: 'thing' });
  });

  it('THE RULING: says null when the alarm names no resource at all', () => {
    // An account-wide alarm and a composite alarm both land here, and the page has to say so rather than
    // printing an empty box where a resource should be.
    expect(resourceOf({ dimensions: {} })).toBeNull();
  });
});

describe('the value AWS quoted', () => {
  it('reads the datapoint out of the sentence CloudWatch writes', () => {
    expect(reportedValue('Threshold Crossed: 1 datapoint [83.0 (24/09/25 12:00:00)] was greater than the threshold (80.0).')).toBe(83);
    expect(reportedValue('Threshold Crossed: 2 datapoints [12.5 (24/09/25 12:00:00), 14.0 (24/09/25 12:05:00)] were less than 20.0')).toBe(12.5);
    expect(reportedValue('Threshold Crossed: 1 datapoint [-3.5 (24/09/25 12:00:00)] was less than -1.0')).toBe(-3.5);
  });

  it('THE RULING: says null for any sentence that is not that shape', () => {
    // A number parsed out of prose OpsWatch does not recognise is a fabrication with a decimal point on
    // it. The raw sentence stays available; the figure simply is not shown.
    expect(reportedValue('Insufficient Data: 1 datapoint was unknown.')).toBeNull();
    expect(reportedValue('')).toBeNull();
    expect(reportedValue('the threshold (80.0) was crossed')).toBeNull();
    expect(reportedValue('alarm was updated by user')).toBeNull();
  });
});

describe('why AWS says the alarm is where it is', () => {
  it('recognises the three sentences it actually writes', () => {
    expect(reasonKind('Threshold Crossed: 1 datapoint [83.0 (…)] was greater than 80.0')).toBe('crossed');
    expect(reasonKind('Threshold Crossed: 1 datapoint was no longer breaching the threshold')).toBe('crossed');
    expect(reasonKind('1 datapoint is within the threshold (80.0)')).toBe('within');
    expect(reasonKind('Insufficient Data: 3 datapoints were unknown.')).toBe('no_data');
  });

  it('THE RULING: says nothing rather than paraphrasing prose it does not recognise', () => {
    expect(reasonKind('Alarm updated by an administrator on Tuesday')).toBeNull();
  });
});

describe('the condition', () => {
  it('renders the comparison as an operator writes it', () => {
    expect(COMPARISONS.GreaterThanThreshold).toBe('>');
    expect(COMPARISONS.LessThanOrEqualToThreshold).toBe('≤');
  });

  it('THE RULING: the window is only known when both halves are', () => {
    // "over 80% once" and "over 80% for fifteen minutes" are different alarms, and a missing half must
    // not silently become one datapoint.
    expect(windowSeconds({ period: 300, evaluationPeriods: 3 })).toBe(900);
    expect(windowSeconds({ period: 300, evaluationPeriods: null })).toBeNull();
    expect(windowSeconds({ period: null, evaluationPeriods: 3 })).toBeNull();
  });

  it('gives a composite alarm no derived title, because it has no metric', () => {
    expect(titleParts({ metricName: null, dimensions: {} })).toBeNull();
    expect(titleParts({ metricName: 'CPUUtilization', dimensions: { CacheClusterId: 'redis-prod' } })).toEqual({
      metric: 'CPUUtilization',
      resource: 'redis-prod',
    });
    // A metric alarm with no dimensions still has a metric worth naming.
    expect(titleParts({ metricName: 'CPUUtilization', dimensions: {} })).toEqual({ metric: 'CPUUtilization', resource: null });
  });
});

describe('the summary at the top', () => {
  const alarms = [
    { state: 'OK' as const },
    { state: 'OK' as const },
    { state: 'ALARM' as const },
    { state: 'INSUFFICIENT_DATA' as const },
  ];

  it('THE RULING: an alarm AWS could not evaluate is never counted as OK', () => {
    // Folding it into OK is how a dashboard reports health it has not got.
    expect(countStates(alarms)).toEqual({ total: 4, OK: 2, ALARM: 1, INSUFFICIENT_DATA: 1 });
  });

  it('counts nothing as nothing', () => {
    expect(countStates([])).toEqual({ total: 0, OK: 0, ALARM: 0, INSUFFICIENT_DATA: 0 });
  });
});

describe('what changed lately', () => {
  const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);

  it('is measured from the timestamp AWS gave, and is false without one', () => {
    expect(changedWithin({ stateUpdatedAt: NOW - 60_000 }, NOW, 15 * 60_000)).toBe(true);
    expect(changedWithin({ stateUpdatedAt: NOW - 60 * 60_000 }, NOW, 15 * 60_000)).toBe(false);
    // No timestamp is not "changed just now".
    expect(changedWithin({ stateUpdatedAt: null }, NOW, 15 * 60_000)).toBe(false);
  });
});

describe('naming a metric', () => {
  it('THE RULING: a metric OpsWatch has no phrase for returns null, so the caller prints the AWS name', () => {
    // The page used to ask next-intl for `Monitoring.metrics.<lowercased name>`. next-intl does not throw
    // for a missing message, it renders the key path — so the row read
    // `Monitoring.metrics.businesstransactionsfailedperminuteacrossallregions on web`.
    expect(metricKey('BusinessTransactionsFailedPerMinuteAcrossAllRegions')).toBeNull();
    expect(metricKey('CPUUtilization')).toBe('cpu');
  });

  it('has no metric at all for a composite alarm', () => {
    expect(metricKey(null)).toBeNull();
  });

  it('is keyed on the exact AWS spelling, because a near miss is a different metric', () => {
    expect(metricKey('cpuutilization')).toBeNull();
    expect(metricKey('EngineCPUUtilization')).toBe('engineCpu');
  });

  it('names every key it promises, in both locales', async () => {
    const en = (await import('../../messages/en.json')).default;
    const fr = (await import('../../messages/fr.json')).default;
    for (const name of ['CPUUtilization', 'EngineCPUUtilization', 'DatabaseConnections', 'HTTPCode_Target_5XX_Count', 'ApproximateAgeOfOldestMessage']) {
      const key = metricKey(name);
      expect(key).not.toBeNull();
      expect(en.Monitoring.alarms.metricNames).toHaveProperty(key as string);
      expect(fr.Monitoring.alarms.metricNames).toHaveProperty(key as string);
    }
  });
});

describe('what AWS actually observed', () => {
  const crossed = 'Threshold Crossed: 2 out of the last 2 datapoints [83.0 (24/09/25 12:00:00), 91.5 (24/09/25 12:05:00)] were greater than the threshold (64.0).';

  it('THE RULING: the breach count is AWS’s own, never the configuration dressed as a measurement', () => {
    // `datapointsToAlarm` says how many *would have to* breach. This says how many did.
    expect(breachedDatapoints(crossed)).toEqual({ breached: 2, evaluated: 2 });
    expect(breachedDatapoints('Threshold Crossed: 1 datapoint [83.0 (24/09/25 12:00:00)] was greater than the threshold (5.0).')).toBeNull();
  });

  it('reads the shape AWS writes when only some datapoints breached', () => {
    expect(breachedDatapoints('Threshold Crossed: 3 out of the last 5 datapoints were greater than the threshold (80.0).')).toEqual({
      breached: 3,
      evaluated: 5,
    });
  });

  it('refuses a sentence it has misread rather than reporting an impossible count', () => {
    expect(breachedDatapoints('9 out of the last 2 datapoints')).toBeNull();
    expect(breachedDatapoints('no datapoints were received')).toBeNull();
    expect(breachedDatapoints('')).toBeNull();
  });

  it('carries every datapoint AWS quoted, because two moving one way say more than one', () => {
    expect(reportedValues(crossed)).toEqual([83, 91.5]);
    expect(reportedValues('Insufficient Data: 3 datapoints were unknown.')).toEqual([]);
  });
});
