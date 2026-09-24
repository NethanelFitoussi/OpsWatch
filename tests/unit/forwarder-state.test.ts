import { describe, expect, it } from 'vitest';
import { DEGRADED_REJECT_SHARE, FORWARDER_STATES, forwarderState, type ForwarderFactsInput } from '@/lib/monitoring/shared/forwarder-state';

const facts = (over: Partial<ForwarderFactsInput> = {}): ForwarderFactsInput => ({
  managed: true,
  verified: true,
  activeGroups: 1,
  events: 100,
  rejected: 0,
  deadLetters: 0,
  ...over,
});

describe('the states a forwarder can be in', () => {
  it('are a closed list, every one of which the page has a word for', () => {
    expect([...FORWARDER_STATES]).toEqual(['not_installed', 'inactive', 'healthy', 'degraded', 'error', 'unknown']);
  });
});

describe('THE RULING: a forwarder nobody is sending to is not unhealthy', () => {
  it('is inactive when no log group has been asked to send', () => {
    // A quiet estate is the most ordinary thing in the world. Calling it `degraded` teaches an operator
    // to ignore the word.
    expect(forwarderState(facts({ activeGroups: 0, events: 0 }))).toBe('inactive');
  });

  it('is unknown when it has been asked but nothing has arrived yet', () => {
    // Out of hours, a staging environment, a service that simply did not log. OpsWatch has not heard
    // anything; it does not know that anything is wrong.
    expect(forwarderState(facts({ events: 0, rejected: 0 }))).toBe('unknown');
  });

  it('is unknown before anything in the account has been confirmed', () => {
    expect(forwarderState(facts({ verified: false }))).toBe('unknown');
  });

  it('is not installed when nobody enabled managed collection', () => {
    expect(forwarderState(facts({ managed: false, verified: false, activeGroups: 0, events: 0 }))).toBe('not_installed');
  });
});

describe('when something is actually wrong', () => {
  it('THE RULING: a dead letter outranks everything, because nothing else can see one', () => {
    // A batch that never arrived left no trace in OpsWatch's own counters.
    expect(forwarderState(facts({ deadLetters: 1 }))).toBe('error');
    expect(forwarderState(facts({ deadLetters: 1, events: 100_000 }))).toBe('error');
  });

  it('is healthy when records are arriving and nothing is being refused', () => {
    expect(forwarderState(facts())).toBe('healthy');
  });

  it('is degraded when a real share of what arrives is being refused', () => {
    const rejected = Math.ceil(100 * DEGRADED_REJECT_SHARE) + 1;
    expect(forwarderState(facts({ events: 100 - rejected, rejected }))).toBe('degraded');
  });

  it('is not degraded by one refusal in a busy minute', () => {
    // A log group that was just unticked, or a clock that drifted.
    expect(forwarderState(facts({ events: 1000, rejected: 1 }))).toBe('healthy');
  });

  it('is degraded when everything is being refused', () => {
    expect(forwarderState(facts({ events: 0, rejected: 10 }))).toBe('degraded');
  });

  it('says nothing when the dead-letter queue could not be read, rather than assuming it is empty', () => {
    // `null` is "not measured": a queue OpsWatch could not read is not a queue known to be empty.
    expect(forwarderState(facts({ deadLetters: null }))).toBe('healthy');
    expect(forwarderState(facts({ deadLetters: null, events: 0, rejected: 0 }))).toBe('unknown');
  });
});
