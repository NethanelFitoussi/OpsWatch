import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';
import { METRIC_FAMILIES, RESOURCE_KINDS, familyOf, subjectOf } from '@/lib/monitoring/shared/metric-catalogue';

const families = { en: en.Monitoring.metrics.families, fr: fr.Monitoring.metrics.families } as Record<
  string,
  Record<string, { title: string; means: string; matters: string; checks: Record<string, string> }>
>;

describe('THE RULING: an alarm is described by its metric, never by its own name', () => {
  it('reads a metric-math alarm the way Application Insights writes one', () => {
    // The real alarm name from a real estate is
    // `ApplicationInsights/ApplicationInsights-ContainerInsights-ECS_CLUSTER-ecs-gigs-prod/AWS/ECS/CPUReservation/…`
    // and nobody should ever have to read it to find out what is wrong.
    const family = familyOf({ namespace: 'AWS/ECS', metricName: 'CPUReservation' });
    expect(family).toMatchObject({ id: 'ecsCpuReservation', resource: 'ecs-cluster', shape: 'percent' });
    expect(families.en[family!.id].title).toBe('CPU reservation is above its threshold');
  });

  it('tells the same metric name apart by where it is measured', () => {
    // `CPUUtilization` on a database is not `CPUUtilization` on an ECS service, and advice written for
    // one would be wrong for the other.
    expect(familyOf({ namespace: 'AWS/ECS', metricName: 'CPUUtilization' })?.id).toBe('ecsCpuUtilization');
    expect(familyOf({ namespace: 'AWS/EC2', metricName: 'CPUUtilization' })?.id).toBe('ec2Cpu');
    expect(familyOf({ namespace: 'AWS/RDS', metricName: 'CPUUtilization' })?.id).toBe('rdsCpu');
    expect(familyOf({ namespace: 'AWS/ElastiCache', metricName: 'CPUUtilization' })?.id).toBe('redisCpu');
  });

  it('THE RULING: a metric it has never heard of gets no invented explanation', () => {
    expect(familyOf({ namespace: 'Acme/Custom', metricName: 'BusinessTransactionsFailed' })).toBeNull();
    expect(familyOf({ namespace: null, metricName: null })).toBeNull();
    expect(familyOf({ namespace: 'AWS/ECS', metricName: 'SomethingNew' })).toBeNull();
  });

  it('covers the families a real estate actually alarms on', () => {
    for (const [namespace, metric] of [
      ['AWS/ECS', 'CPUReservation'],
      ['AWS/ECS', 'MemoryReservation'],
      ['AWS/ApplicationELB', 'HTTPCode_Target_4XX_Count'],
      ['AWS/ApplicationELB', 'HTTPCode_Target_5XX_Count'],
      ['AWS/ApplicationELB', 'TargetResponseTime'],
      ['AWS/EC2', 'CPUUtilization'],
      ['AWS/RDS', 'FreeStorageSpace'],
      ['AWS/ElastiCache', 'EngineCPUUtilization'],
    ] as const) {
      expect(familyOf({ namespace, metricName: metric }), `${namespace}/${metric}`).not.toBeNull();
    }
  });
});

describe('every family says all four things, in both locales', () => {
  it.each(METRIC_FAMILIES.map((family) => [family.id, family] as const))('%s', (id, family) => {
    for (const locale of ['en', 'fr'] as const) {
      const entry = families[locale][id];
      expect(entry, `${locale} is missing ${id}`).toBeDefined();
      // A title that reads as a sentence, not a metric name: it must not be the AWS identifier back again.
      expect(entry.title.length, `${locale}/${id} title`).toBeGreaterThan(10);
      expect(entry.means.length, `${locale}/${id} means`).toBeGreaterThan(40);
      expect(entry.matters.length, `${locale}/${id} matters`).toBeGreaterThan(40);
      expect(Object.keys(entry.checks), `${locale}/${id} checks`).toHaveLength(family.checks);
    }
  });

  it('THE RULING: the French is a translation, not the English again', () => {
    const same = METRIC_FAMILIES.filter((family) => families.en[family.id].title === families.fr[family.id].title);
    expect(same.map((family) => family.id)).toEqual([]);
  });

  it('phrases the steps as things to check, never as the cause', () => {
    // "Possible causes" are not "the cause", and a numbered list that asserts one would be the whole
    // product's rule broken in the one place an operator is most likely to believe it.
    for (const family of METRIC_FAMILIES) {
      for (const [index, step] of Object.entries(families.en[family.id].checks)) {
        expect(step, `${family.id}.${index}`).not.toMatch(/\bis caused by\b|\bbecause of\b|\bthe cause is\b/i);
      }
    }
  });
});

describe('what an alarm is about', () => {
  const alarm = (dimensions: Record<string, string>, namespace = 'AWS/ECS', metricName = 'CPUReservation') => ({
    namespace,
    metricName,
    dimensions,
  });

  it('names the kind from the family, so a reader is told rather than left to infer it', () => {
    expect(subjectOf(alarm({ ClusterName: 'ecs-gigs-prod' }), [])).toEqual({ kind: 'ecs-cluster', name: 'ecs-gigs-prod' });
  });

  it('prefers the most specific dimension the family cares about', () => {
    // A service alarm carries both, and the service is what the reader is looking for.
    const service = alarm({ ClusterName: 'ecs-gigs-prod', ServiceName: 'checkout' }, 'AWS/ECS', 'CPUUtilization');
    expect(subjectOf(service, [])).toEqual({ kind: 'ecs-service', name: 'checkout' });
  });

  it('THE RULING: an unknown metric still names its resource, but not its kind', () => {
    const custom = alarm({ Service: 'payments' }, 'Acme/Custom', 'Failures');
    expect(subjectOf(custom, ['Service'])).toEqual({ kind: 'unknown', name: 'payments' });
  });

  it('is null when the alarm names nothing at all', () => {
    expect(subjectOf(alarm({}, 'Acme/Custom', 'Failures'), [])).toBeNull();
  });

  it('offers a kind for every resource the catalogue uses', () => {
    for (const family of METRIC_FAMILIES) expect(RESOURCE_KINDS, family.id).toContain(family.resource);
  });
});
