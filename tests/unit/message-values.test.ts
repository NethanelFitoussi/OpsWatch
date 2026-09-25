import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';
import { expandValues } from '@/lib/read/message-values';

/**
 * THE RULING: a stored problem is language-neutral, and becomes a sentence in the reader's language.
 *
 * The failure this exists to stop is a report row reading
 * `Alarm ApplicationInsights/ApplicationInsights-ContainerInsights-ECS_CLUSTER-prod/AWS/ECS/…` — an AWS
 * identifier read aloud. The fix cannot be to write "CPU reservation on ECS cluster prod" into the
 * database, because that would freeze English into every row a French reader ever sees.
 */

type Tree = { [key: string]: string | Tree };
const catalogue = (messages: unknown) => (key: string) => {
  const value = key.split('.').reduce<unknown>((node, part) => (node as Tree)?.[part], messages);
  return typeof value === 'string' ? value : null;
};

describe('expanding the ids a detector stored', () => {
  it('turns the metric and the resource into words', () => {
    expect(expandValues({ alarm: 'x', metricKey: 'cpuReservation', subjectKind: 'ecs-cluster', subjectName: 'prod' }, catalogue(en))).toEqual({
      alarm: 'x',
      metricKey: 'cpuReservation',
      subjectKind: 'ecs-cluster',
      subjectName: 'prod',
      metric: 'CPU reservation',
      subject: 'ECS cluster prod',
    });
  });

  it('THE RULING: the same stored row reads as French for a French reader', () => {
    const values = { metricKey: 'cpuReservation', subjectKind: 'ecs-cluster', subjectName: 'prod' };
    expect(expandValues(values, catalogue(fr))).toMatchObject({ metric: 'Réservation CPU', subject: 'Cluster ECS prod' });
  });

  it('leaves the slot out when the id has no message, rather than printing the id', () => {
    // A missing message must never reach a reader as its own key path — which is exactly what next-intl
    // does if the lookup is allowed to answer with one.
    expect(expandValues({ metricKey: 'nothing-like-this' }, catalogue(en))).toEqual({ metricKey: 'nothing-like-this' });
  });

  it('names the resource alone when its kind is not one OpsWatch recognises', () => {
    expect(expandValues({ subjectKind: 'unknown', subjectName: 'thing-1' }, catalogue(en)).subject).toBe('thing-1');
    expect(expandValues({ subjectName: 'thing-1' }, catalogue(en)).subject).toBe('thing-1');
  });

  it('changes nothing for a problem that stored no ids at all', () => {
    expect(expandValues({ service: 'web', count: 3 }, catalogue(en))).toEqual({ service: 'web', count: 3 });
  });
});
