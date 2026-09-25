import { describe, expect, it } from 'vitest';
import { HOST_REPORT_INTERVAL_SECONDS } from '@opswatch/contract';
import { hasReadings, hostSeries } from '@/lib/monitoring/shared/host-series';

/**
 * A host's readings as a chart.
 *
 * One rule, and it is the whole file: a chart must not draw a line through a period nobody measured.
 * An agent that did not run for two hours leaves a hole, and a straight line across that hole is a
 * confident claim about two hours of silence.
 */

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const STEP = HOST_REPORT_INTERVAL_SECONDS * 1000;

const sample = (at: number, cpuPercent: number | null) => ({ at, cpuPercent });

describe('a run of readings', () => {
  it('comes back oldest first, whatever order it was stored in', () => {
    const series = hostSeries([sample(NOW, 3), sample(NOW - STEP, 2), sample(NOW - 2 * STEP, 1)], 'cpuPercent');
    expect(series.values).toEqual([1, 2, 3]);
    expect(series.timestamps).toEqual([NOW - 2 * STEP, NOW - STEP, NOW]);
  });

  it('draws straight through a single late report, because one is ordinary', () => {
    // An agent is a cron entry on somebody's machine. One run a minute behind is not a gap.
    const series = hostSeries([sample(NOW - 2 * STEP, 1), sample(NOW - STEP + 30_000, 2), sample(NOW, 3)], 'cpuPercent');
    expect(series.values).toEqual([1, 2, 3]);
  });

  it('THE RULING: it breaks the line where the agent went quiet', () => {
    /*
     * Recharts draws a straight line between the points it is given. Without a break, two hours of
     * silence become a confident line across two hours — a measurement nobody took, drawn as though
     * somebody had.
     */
    const series = hostSeries([sample(NOW - 24 * STEP, 1), sample(NOW, 3)], 'cpuPercent');
    expect(series.values).toEqual([1, null, 3]);
    // The break sits just after the last real reading, so the line stops there rather than reaching on.
    expect(series.timestamps[1]).toBe(NOW - 24 * STEP + 1);
  });

  it('treats a figure the agent could not measure as a gap, not a zero', () => {
    // A CPU rate needs two readings, so the agent's first run has none. Plotting 0% would draw an idle
    // machine that nobody observed.
    const series = hostSeries([sample(NOW - STEP, null), sample(NOW, 40)], 'cpuPercent');
    expect(series.values).toEqual([null, 40]);
  });

  it('knows when there is nothing to draw', () => {
    expect(hasReadings(hostSeries([], 'cpuPercent'))).toBe(false);
    expect(hasReadings(hostSeries([sample(NOW, null)], 'cpuPercent'))).toBe(false);
    expect(hasReadings(hostSeries([sample(NOW, 0)], 'cpuPercent'))).toBe(true);
  });
});
