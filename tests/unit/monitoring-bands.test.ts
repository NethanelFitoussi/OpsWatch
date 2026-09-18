import { describe, expect, it } from 'vitest';
import { bandsFor, cpuBand, toneForValue, volumeBand } from '@/lib/monitoring/shared/bands';

const cpu = { warning: 85, critical: 95, direction: 'above' } as const;
const memory = { warning: 5, direction: 'below' } as const;

describe('bandsFor', () => {
  it('builds healthy, warning and critical bands for an upward threshold', () => {
    expect(bandsFor(cpu, 100)).toEqual([
      { from: 0, to: 85, tone: 'success' },
      { from: 85, to: 95, tone: 'warning' },
      { from: 95, to: 100, tone: 'danger' },
    ]);
  });
  it('leaves the top band open when there is no maximum', () => {
    expect(bandsFor({ warning: 1, direction: 'above' }, null)).toEqual([
      { from: 0, to: 1, tone: 'success' },
      { from: 1, to: null, tone: 'warning' },
    ]);
  });
  it('inverts the bands for a downward threshold', () => {
    expect(bandsFor(memory, 100)).toEqual([
      { from: 0, to: 5, tone: 'warning' },
      { from: 5, to: 100, tone: 'success' },
    ]);
  });
});

describe('toneForValue', () => {
  it('is exclusive at the threshold, matching breachActive', () => {
    expect(toneForValue(84.9, cpu)).toBe('success');
    expect(toneForValue(85, cpu)).toBe('success');
    expect(toneForValue(85.1, cpu)).toBe('warning');
    expect(toneForValue(96, cpu)).toBe('danger');
    expect(toneForValue(4, memory)).toBe('warning');
    expect(toneForValue(6, memory)).toBe('success');
    expect(toneForValue(null, cpu)).toBeNull();
  });
});

describe('cpuBand and volumeBand', () => {
  it('bands CPU on 10, 50 and 85 per cent', () => {
    expect([null, 0, 9.9, 10, 49, 60, 90].map(cpuBand)).toEqual(['unknown', 'idle', 'idle', 'low', 'low', 'medium', 'high']);
  });
  it('bands volume on 1 MiB, 1 GiB and 10 GiB', () => {
    expect([null, 0, 1_048_575, 1_048_576, 1_073_741_823, 1_073_741_824, 10_737_418_240].map(volumeBand))
      .toEqual(['unknown', 'tiny', 'tiny', 'small', 'small', 'large', 'huge']);
  });
});
