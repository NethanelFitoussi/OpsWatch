import { describe, expect, it } from 'vitest';
import { matchesGroupFilter, toggleGroup, withGroups } from '@/lib/monitoring/shared/logs-selection';

describe('matchesGroupFilter', () => {
  it('matches anywhere in the name, ignoring case and surrounding spaces', () => {
    expect(matchesGroupFilter('/aws/lambda/opswatch-worker', 'LAMBDA')).toBe(true);
    expect(matchesGroupFilter('/aws/lambda/opswatch-worker', '  worker ')).toBe(true);
    expect(matchesGroupFilter('/aws/lambda/opswatch-worker', '/ecs')).toBe(false);
  });

  it('keeps every group while the filter is blank', () => {
    expect(matchesGroupFilter('/ecs/opswatch-web', '')).toBe(true);
    expect(matchesGroupFilter('/ecs/opswatch-web', '   ')).toBe(true);
  });
});

describe('toggleGroup', () => {
  it('appends a group in selection order, and never twice', () => {
    expect(toggleGroup(['a'], 'b', true, 20)).toEqual(['a', 'b']);
    expect(toggleGroup(['a', 'b'], 'a', true, 20)).toEqual(['a', 'b']);
  });

  it('removes a group it holds and leaves the selection alone otherwise', () => {
    expect(toggleGroup(['a', 'b'], 'a', false, 20)).toEqual(['b']);
    expect(toggleGroup(['a'], 'b', false, 20)).toEqual(['a']);
  });

  it('never selects more groups than the API accepts', () => {
    expect(toggleGroup(['a', 'b'], 'c', true, 2)).toEqual(['a', 'b']);
    // Unticking still works once the cap is reached, otherwise the selection could not be changed at all.
    expect(toggleGroup(['a', 'b'], 'b', false, 2)).toEqual(['a']);
  });
});

describe('withGroups', () => {
  it('replaces every group parameter and keeps the rest of the query string', () => {
    expect(withGroups('?prefix=%2Fecs&group=old&range=3h', ['/ecs/a', '/ecs/b'])).toBe(
      'prefix=%2Fecs&range=3h&group=%2Fecs%2Fa&group=%2Fecs%2Fb',
    );
  });

  it('drops the group parameters when nothing is selected', () => {
    expect(withGroups('group=old&range=1h', [])).toBe('range=1h');
    expect(withGroups('', [])).toBe('');
  });
});
