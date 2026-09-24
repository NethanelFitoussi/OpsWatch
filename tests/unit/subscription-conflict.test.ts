import { describe, expect, it } from 'vitest';
import { decideSubscription, failureOf } from '@/lib/monitoring/shared/subscription-conflict';

const OURS = 'OpsWatch-abc123def456';
const FORWARDER = 'arn:aws:lambda:eu-west-1:123456789012:function:opswatch-abc123def456-forwarder';

describe('THE RULING: another vendor’s subscription is never silently replaced', () => {
  it('refuses and names whose it is', () => {
    // "It did not work" is not an answer an operator can act on. "DatadogForwarder is already there" is.
    expect(decideSubscription([{ filterName: 'DatadogForwarder', destinationArn: 'arn:aws:lambda:…:datadog' }], OURS, FORWARDER)).toEqual({
      kind: 'conflict',
      owner: 'DatadogForwarder',
    });
  });

  it('refuses even when there would be room beside it', () => {
    // Whether a second slot is free is AWS's answer, not a number hardcoded here — and a log group
    // carrying somebody else's forwarder is one OpsWatch leaves exactly as it found it.
    const existing = [
      { filterName: 'DatadogForwarder', destinationArn: 'arn:datadog' },
      { filterName: OURS, destinationArn: FORWARDER },
    ];
    expect(decideSubscription(existing, OURS, FORWARDER)).toMatchObject({ kind: 'conflict' });
  });

  it('is not fooled by a name that merely looks like ours', () => {
    for (const name of ['opswatch-lowercase', 'my-OpsWatch-copy', 'OpsWatchForwarder']) {
      const decision = decideSubscription([{ filterName: name, destinationArn: 'arn:x' }], OURS, FORWARDER);
      // Only a filter whose name starts with the prefix OpsWatch writes is OpsWatch's.
      if (name.startsWith('OpsWatch-')) expect(decision.kind, name).not.toBe('conflict');
      else expect(decision, name).toMatchObject({ kind: 'conflict' });
    }
  });
});

describe('what to do when nothing is in the way', () => {
  it('creates when the group has nothing on it', () => {
    expect(decideSubscription([], OURS, FORWARDER)).toEqual({ kind: 'create' });
  });

  it('does nothing when ours is already there and already right', () => {
    expect(decideSubscription([{ filterName: OURS, destinationArn: FORWARDER }], OURS, FORWARDER)).toEqual({ kind: 'already' });
  });

  it('updates when ours points at a forwarder that is no longer the one', () => {
    // A re-installed stack gives the function a new ARN; the filter has to follow it.
    expect(decideSubscription([{ filterName: OURS, destinationArn: 'arn:aws:lambda:…:old' }], OURS, FORWARDER)).toEqual({ kind: 'update' });
  });

  it('updates when another OpsWatch instance’s filter is there, rather than calling it a conflict', () => {
    // Two OpsWatch instances watching one account each write their own name, so this is a filter with a
    // different connection id — not somebody else's product.
    expect(decideSubscription([{ filterName: 'OpsWatch-other000000', destinationArn: 'arn:other' }], OURS, FORWARDER)).toEqual({ kind: 'update' });
  });
});

describe('reading AWS’s refusal', () => {
  it('tells apart the one an operator fixes differently', () => {
    // A full log group is fixed by removing something, not by trying again.
    expect(failureOf('LimitExceededException')).toBe('limit');
    expect(failureOf('AccessDeniedException')).toBe('denied');
    expect(failureOf('ResourceNotFoundException')).toBe('not_found');
    expect(failureOf('ThrottlingException')).toBe('failed');
    expect(failureOf(undefined)).toBe('failed');
  });
});
