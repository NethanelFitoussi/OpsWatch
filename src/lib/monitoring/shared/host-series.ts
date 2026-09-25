import { HOST_REPORT_INTERVAL_SECONDS } from '@opswatch/contract';

/**
 * A host's readings as a chart, with the gaps left as gaps.
 *
 * The agent reports on a schedule, so a missing run leaves a hole in the series. Recharts draws a
 * straight line between the points it is given, which would turn "the agent did not run for two hours"
 * into a confident line across those two hours — a measurement nobody took, drawn as though somebody
 * had. A `null` at each gap breaks the line instead, and the break is the honest rendering of silence.
 *
 * Pure: it takes the samples and returns the series.
 */

/** A reading is part of the same run of data while it is no further than this from the one before. */
const GAP_AFTER_MS = HOST_REPORT_INTERVAL_SECONDS * 1000 * 2.5;

export type HostSeriesPoint = { at: number; value: number | null };

/**
 * One metric out of a host's samples, oldest first, with a null wherever the agent went quiet.
 *
 * A sample whose figure is `null` — a CPU rate on the agent's first run, a kernel that does not publish
 * a value — is itself a gap. It is not a zero, and it is not a reason to drop the whole reading.
 */
export function hostSeries(
  samples: readonly { at: number; [key: string]: unknown }[],
  field: string,
): { timestamps: number[]; values: (number | null)[] } {
  const ordered = [...samples].sort((a, b) => a.at - b.at);
  const timestamps: number[] = [];
  const values: (number | null)[] = [];

  ordered.forEach((sample, index) => {
    const previous = ordered[index - 1];
    if (previous !== undefined && sample.at - previous.at > GAP_AFTER_MS) {
      // A marker inside the silence, so the line stops at the last reading rather than reaching across.
      timestamps.push(previous.at + 1);
      values.push(null);
    }
    const raw = sample[field];
    timestamps.push(sample.at);
    values.push(typeof raw === 'number' ? raw : null);
  });

  return { timestamps, values };
}

/** Whether a series has anything to draw. A series of nothing but gaps is not a chart. */
export function hasReadings(series: { values: (number | null)[] }): boolean {
  return series.values.some((value) => value !== null);
}
